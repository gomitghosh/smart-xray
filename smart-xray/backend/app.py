"""
SMART XRAY — Flask backend
==========================================================================
Connects the existing Smart Xray web frontend to the existing
TensorFlow/Keras pneumonia model and the existing Grad-CAM implementation.

    Frontend (js/analysis.js)
        │  POST /api/analyze   (multipart/form-data)
        ▼
    Flask (this file)
        │  load model ONCE at startup
        ▼
    backend/predict.py   →  preprocessing + PNEUMONIA / NORMAL prediction
        │
        ▼
    backend/gradcam.py   →  Grad-CAM heatmap (reuses the existing algorithm)
        │
        ▼
    JSON response  { prediction, confidence, original_image, heatmap_image,
                     analysis_id, timestamp }

Run:
    pip install -r backend/requirements.txt
    python backend/app.py                → http://localhost:5000

NOTE: this file NEVER trains the model. The trained artifact
      (backend/model/smart_xray_model.h5, produced by train_model.py) is
      loaded exactly once when the server starts, then reused for every
      /api/analyze request.
==========================================================================
"""

import io
import json
import os
import re
import threading
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image
from werkzeug.utils import secure_filename

# ---------------------------------------------------------------------------
# Paths (resolved relative to this file, so the server runs from any cwd)
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BACKEND_DIR / "uploads"
RESULTS_DIR = BACKEND_DIR / "results"
ORIGINAL_DIR = RESULTS_DIR / "original"
HEATMAP_DIR = RESULTS_DIR / "heatmap"
MODEL_DIR = BACKEND_DIR / "model"

for _dir in (UPLOAD_DIR, ORIGINAL_DIR, HEATMAP_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

# The trained model artifact saved by train_model.py.
# Override with the SMART_XRAY_MODEL_PATH environment variable if needed.
MODEL_PATH = os.environ.get(
    "SMART_XRAY_MODEL_PATH",
    str(MODEL_DIR / "smart_xray_model.h5"),
)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_CONTENT_LENGTH = 15 * 1024 * 1024  # 15 MB

# ---------------------------------------------------------------------------
# App + CORS (the frontend on :5500 and the backend on :5000 are different
# origins, so CORS is required for fetch() and for the PDF generator).
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
CORS(app)

# ---------------------------------------------------------------------------
# Load the trained TensorFlow model ONCE at startup.
# If it cannot be loaded, the server still starts so that GET /api/health can
# report the real state (model_loaded: false) instead of silently faking it.
# ---------------------------------------------------------------------------
MODEL = None
MODEL_LOAD_ERROR = None
GRADCAM_LAYER = "out_relu"  # the layer train_model.py's MobileNetV2 exposes


def _load_model_once():
    global MODEL, MODEL_LOAD_ERROR, GRADCAM_LAYER
    try:
        # predict.py holds the existing inference/preprocessing helpers.
        from predict import load_xray_model

        MODEL = load_xray_model(MODEL_PATH)
        MODEL_LOAD_ERROR = None
        GRADCAM_LAYER = _resolve_gradcam_layer(MODEL)
    except Exception as exc:  # noqa: BLE001 — report via /api/health, don't crash
        MODEL = None
        MODEL_LOAD_ERROR = str(exc)


def _resolve_gradcam_layer(model):
    """Return the name of the layer gradcam.py should target.

    The existing gradcam.py defaults to ``out_relu`` (the ReLU that follows
    the final convolution of MobileNetV2).  If that layer is not present in a
    given model artifact, fall back to the last Conv2D layer so Grad-CAM still
    works without rewriting the existing algorithm.
    """
    import tensorflow as tf

    for preferred in ("out_relu", "Conv_1"):
        try:
            model.get_layer(preferred)
            return preferred
        except (ValueError, AttributeError):
            continue

    conv_layers = [layer for layer in model.layers
                   if isinstance(layer, tf.keras.layers.Conv2D)]
    if conv_layers:
        return conv_layers[-1].name

    raise RuntimeError("No convolutional layer found for Grad-CAM in this model.")


_load_model_once()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _allowed(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _new_analysis_id():
    """Generate the next ``XR-YYYY-NNNN`` id, continuing from what is already
    on disk so ids stay unique across server restarts."""
    year = datetime.now().year
    pattern = re.compile(r"^XR-(\d{4})-(\d{4})$")
    highest = 0
    for directory in (ORIGINAL_DIR, HEATMAP_DIR, UPLOAD_DIR):
        try:
            for name in os.listdir(directory):
                match = pattern.match(Path(name).stem)
                if match and int(match.group(1)) == year:
                    highest = max(highest, int(match.group(2)))
        except OSError:
            continue
    return f"XR-{year}-{highest + 1:04d}"


_ID_LOCK = threading.Lock()


def _next_analysis_id():
    with _ID_LOCK:
        return _new_analysis_id()


def _write_sidecar(analysis_id, patient, label, confidence, timestamp):
    """Persist the full analysis record (patient details included) next to the
    generated images, for audit / future database migration."""
    record = {
        "analysis_id": analysis_id,
        "timestamp": timestamp,
        "prediction": label,
        "confidence": confidence,
        "patient": patient,
    }
    try:
        (RESULTS_DIR / f"{analysis_id}.json").write_text(
            json.dumps(record, indent=2), encoding="utf-8"
        )
    except OSError:
        pass  # persistence is best-effort for the prototype


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    """Liveness + model status. The frontend health indicator polls this."""
    payload = {
        "status": "ok" if MODEL is not None else "error",
        "model_loaded": MODEL is not None,
    }
    if MODEL_LOAD_ERROR:
        payload["error"] = MODEL_LOAD_ERROR
    return jsonify(payload)


@app.route("/api/analyze", methods=["POST"])
def analyze():
    # ── Step 0: model must be loaded (never trained here) ────────────────
    if MODEL is None:
        return jsonify({
            "error": "AI model could not process this X-ray. "
                     "Please verify the model and try again."
        }), 500

    # ── Step 1: validate an image was uploaded ───────────────────────────
    file = request.files.get("image")
    if file is None or not file.filename:
        return jsonify({
            "error": "Please upload a JPG, JPEG or PNG chest X-ray."
        }), 400

    if not _allowed(file.filename):
        return jsonify({
            "error": "Please upload a JPG, JPEG or PNG chest X-ray."
        }), 400

    data = file.read()

    # Decode + verify the real image format (rejects disguised files).
    try:
        with Image.open(io.BytesIO(data)) as probe:
            img_format = probe.format
            pil_image = probe.convert("RGB")
            pil_image.load()
    except Exception:
        return jsonify({
            "error": "Please upload a JPG, JPEG or PNG chest X-ray."
        }), 400

    if img_format not in ("JPEG", "PNG"):
        return jsonify({
            "error": "Please upload a JPG, JPEG or PNG chest X-ray."
        }), 400

    # ── Step 1b: capture patient details (echoed into the sidecar record) ─
    patient = {
        "patient_name": (request.form.get("patient_name") or "").strip(),
        "patient_id": (request.form.get("patient_id") or "").strip(),
        "age": (request.form.get("age") or "").strip(),
        "gender": (request.form.get("gender") or "").strip(),
        "clinical_notes": (request.form.get("clinical_notes") or "").strip(),
    }

    # ── Step 2: unique analysis id ───────────────────────────────────────
    analysis_id = _next_analysis_id()
    timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    # ── Step 3: save the raw upload ──────────────────────────────────────
    ext = Path(secure_filename(file.filename)).suffix.lower() or ".jpg"
    (UPLOAD_DIR / f"{analysis_id}{ext}").write_bytes(data)

    # ── Save the served original (normalised RGB JPEG for the browser) ───
    original_name = f"{analysis_id}.jpg"
    original_path = ORIGINAL_DIR / original_name
    pil_image.save(str(original_path), "JPEG", quality=95)

    # ── Step 4-6: preprocess + run the trained model ─────────────────────
    try:
        from predict import predict_pneumonia

        label, confidence_fraction, _img_tensor = predict_pneumonia(pil_image, MODEL)
    except Exception:
        return jsonify({
            "error": "AI model could not process this X-ray. "
                     "Please verify the model and try again."
        }), 500

    if label not in ("PNEUMONIA", "NORMAL"):
        return jsonify({"error": "Invalid model response."}), 500

    confidence = round(float(confidence_fraction) * 100, 2)

    # ── Step 8-9: generate the real Grad-CAM heatmap ─────────────────────
    try:
        from gradcam import generate_gradcam

        heatmap_name = f"{analysis_id}.jpg"
        heatmap_path = HEATMAP_DIR / heatmap_name
        generate_gradcam(
            str(original_path),
            MODEL,
            str(heatmap_path),
            last_conv_layer_name=GRADCAM_LAYER,
        )
    except Exception:
        return jsonify({
            "error": "Could not generate the Grad-CAM heatmap for this X-ray. "
                     "Please verify the model and try again."
        }), 500

    # ── Persist the record (patient details preserved) ───────────────────
    _write_sidecar(analysis_id, patient, label, confidence, timestamp)

    # ── Step 10: return the JSON contract the frontend already expects ───
    base = request.host_url.rstrip("/")  # e.g. http://localhost:5000
    return jsonify({
        "prediction": label,
        "confidence": confidence,
        "original_image": f"{base}/results/original/{original_name}",
        "heatmap_image": f"{base}/results/heatmap/{heatmap_name}",
        "analysis_id": analysis_id,
        "timestamp": timestamp,
    })


@app.route("/results/original/<path:filename>")
def serve_original(filename):
    """Serve the uploaded X-ray the browser will display."""
    return send_from_directory(ORIGINAL_DIR, filename)


@app.route("/results/heatmap/<path:filename>")
def serve_heatmap(filename):
    """Serve the Grad-CAM overlay generated by gradcam.py."""
    return send_from_directory(HEATMAP_DIR, filename)


@app.errorhandler(413)
def request_too_large(_err):
    return jsonify({
        "error": "File is too large. Maximum upload size is 15 MB."
    }), 413


@app.errorhandler(404)
def not_found(_err):
    return jsonify({"error": "Not found."}), 404


if __name__ == "__main__":
    print("=" * 60)
    print("SMART XRAY — Flask backend")
    print(f"Model artifact : {MODEL_PATH}")
    if MODEL is not None:
        print("TensorFlow model loaded successfully (loaded once at startup).")
        print(f"Grad-CAM target layer : {GRADCAM_LAYER}")
    else:
        print(f"WARNING — model not loaded: {MODEL_LOAD_ERROR}")
        print("Place the trained artifact in backend/model/ and restart.")
    print("API             : http://localhost:5000/api/analyze")
    print("Health          : http://localhost:5000/api/health")
    print("=" * 60)
    # 0.0.0.0 so the API is reachable from the frontend on localhost (and LAN).
    app.run(host="0.0.0.0", port=5000, debug=False)
