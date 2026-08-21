# Smart Xray — AI-Powered Chest X-Ray Screening

Smart Xray is a doctor/patient web app for AI-assisted chest X-ray screening.
This folder contains the **complete, self-contained deliverable**: the web
frontend wired to the real TensorFlow/Keras pneumonia model and Grad-CAM
implementation, so the pipeline is REAL (no mock AI) while the original
design and every existing feature are preserved.

```
HTML/CSS/JS (frontend/)
      │  js/analysis.js  →  POST /api/analyze  (multipart/form-data)
      ▼
Flask (backend/app.py)
      │  loads the trained model ONCE at startup
      ▼
backend/predict.py   →  preprocessing + PNEUMONIA / NORMAL + confidence
      ▼
backend/gradcam.py   →  real Grad-CAM heatmap
      ▼
JSON  { prediction, confidence, original_image, heatmap_image,
        analysis_id, timestamp }
      ▼
report.html  →  original X-ray + Grad-CAM + confidence + verdict → PDF
```

---

## 1. Folder structure

```
smart-xray/
├── frontend/                          # the web application (design unchanged)
│   ├── index.html
│   ├── login.html
│   ├── doctor-dashboard.html
│   ├── patient-dashboard.html
│   ├── analysis.html
│   ├── report.html
│   ├── css/style.css
│   ├── js/auth.js
│   ├── js/dashboard.js
│   ├── js/analysis.js                 # ← API integration layer (edited)
│   ├── js/report.js
│   └── assets/logo/logo.svg
│
├── backend/                           # Flask backend
│   ├── app.py                         # Flask API + static image serving
│   ├── train_model.py                 # your existing training script (kept)
│   ├── gradcam.py                     # your existing Grad-CAM (+ generate_gradcam)
│   ├── predict.py                     # your existing inference helpers (kept)
│   ├── requirements.txt
│   ├── model/
│   │   └── smart_xray_model.h5        # your trained model artifact
│   ├── uploads/                       # raw uploads (git-ignored)
│   └── results/
│       ├── original/                  # served original X-rays (git-ignored)
│       └── heatmap/                   # served Grad-CAM images (git-ignored)
│
├── .gitignore
└── README.md
```

> The original project files you uploaded (`train_model.py`, `gradcam.py`,
> `predict.py`, `smart_xray_model.h5`, `api.py`, `app.py`) are still preserved
> unchanged at the repository root. The runnable integration lives entirely
> inside this `smart-xray/` folder.

---

## 2. Running Smart Xray (local)

### Step 1 — Install the Python dependencies

```bash
cd smart-xray
pip install -r backend/requirements.txt
```

### Step 2 — Start the Flask backend

```bash
python backend/app.py
```

The API starts at **http://localhost:5000**. On startup it loads
`backend/model/smart_xray_model.h5` **once** and prints
`TensorFlow model loaded successfully`.

### Step 3 — Start the frontend

Use a local HTTP server (do **not** open the files with `file://`):

```bash
cd smart-xray/frontend
python -m http.server 5500
```

Then open **http://localhost:5500** in your browser.

### Step 4 — Verify the API

```bash
curl http://localhost:5000/api/health
```

Expected:

```json
{ "status": "ok", "model_loaded": true }
```

### Demo login credentials (mock authentication — kept working)

| Role    | ID / email                           | Password |
|---------|--------------------------------------|----------|
| Doctor  | `DOC-1001` / `doctor@smartxray.in`   | `demo123` |
| Patient | `PX-10294` / `rahul@smartxray.in`    | `demo123` |

Or use the one-click **Doctor Demo** / **Patient Demo** buttons on the login
page.

---

## 3. The analysis API

### `POST /api/analyze`

Accepts `multipart/form-data`:

| Field            | Type   | Notes                                 |
|------------------|--------|---------------------------------------|
| `image`          | file   | `.jpg` / `.jpeg` / `.png` chest X-ray |
| `patient_name`   | text   |                                       |
| `patient_id`     | text   |                                       |
| `age`            | text   |                                       |
| `gender`         | text   |                                       |
| `clinical_notes` | text   |                                       |

Example request:

```bash
curl -X POST http://localhost:5000/api/analyze \
  -F "image=@chest_xray.jpg" \
  -F "patient_name=Rahul Mehta" \
  -F "patient_id=PX-10294" \
  -F "age=42" \
  -F "gender=Male" \
  -F "clinical_notes=Fever x4 days, productive cough"
```

Example response (pneumonia):

```json
{
  "prediction": "PNEUMONIA",
  "confidence": 99.79,
  "original_image": "http://localhost:5000/results/original/XR-2026-0001.jpg",
  "heatmap_image": "http://localhost:5000/results/heatmap/XR-2026-0001.jpg",
  "analysis_id": "XR-2026-0001",
  "timestamp": "2026-08-21T18:30:00"
}
```

Example response (normal):

```json
{
  "prediction": "NORMAL",
  "confidence": 98.42,
  "original_image": "http://localhost:5000/results/original/XR-2026-0002.jpg",
  "heatmap_image": "http://localhost:5000/results/heatmap/XR-2026-0002.jpg",
  "analysis_id": "XR-2026-0002",
  "timestamp": "2026-08-21T18:35:00"
}
```

`confidence` is the model's probability as a percentage (e.g. `99.79`, not
`0.9979`). `prediction` is always exactly `PNEUMONIA` or `NORMAL` — the class
mapping used by `train_model.py` (`class_mode="binary"`, sigmoid ≥ 0.5 → the
positive class).

### `GET /api/health`

```json
{ "status": "ok", "model_loaded": true }
```

### Static images

- `GET /results/original/<filename>` — the uploaded X-ray (normalised RGB JPEG)
- `GET /results/heatmap/<filename>`  — the Grad-CAM overlay from `gradcam.py`

Both are served with CORS enabled so the browser `<img>` tags and the PDF
generator (which `fetch`es the images) can read them.

---

## 4. How the inference works (no training at request time)

```
Flask starts
      ↓
loads backend/model/smart_xray_model.h5  ONCE
      ↓
waits for POST /api/analyze
      ↓
validates image (jpg/jpeg/png, ≤ 15 MB, real decodable image)
      ↓
saves original to uploads/ + results/original/
      ↓
preprocesses EXACTLY as training (resize 224×224, rescale 1/255)  [predict.py]
      ↓
runs the loaded model  →  sigmoid probability
      ↓
PNEUMONIA (≥ 0.5) or NORMAL (< 0.5), confidence in %
      ↓
gradcam.py generates the heatmap for layer "out_relu" (last MobileNetV2 conv)
      ↓
returns JSON (image URLs point back to /results/…)
```

`train_model.py` is never imported or run by the Flask server — the trained
artifact is loaded, not retrained.

---

## 5. Frontend changes made (integration only, no redesign)

| File | Change |
|------|--------|
| `frontend/js/analysis.js` | `MOCK_MODE` set to `false` (flip back to `true` for demo). Backend `{error}` messages are surfaced via the toast/error panel. Real backend image URLs are persisted into the localStorage history store so the report page, dashboard, history and PDF show the actual X-ray + heatmap after a page reload. Added `SXAPI.checkHealth()` + a live `● AI MODEL ONLINE/OFFLINE` indicator. |
| `frontend/doctor-dashboard.html` | Added a **Model status** row (live `GET /api/health`) in the AI Backend Integration settings card. |
| `frontend/analysis.html` | Added a live AI-model health chip to the action bar. |
| `frontend/css/style.css` | Added `.health-chip` styles for the online/offline/checking states. |

Everything else (login, dashboards, Grad-CAM comparison viewer, confidence
ring, PDF report, mock mode, patient portal) is unchanged and still works.

To switch back to the frontend-only demo at any time, edit
`frontend/js/analysis.js`:

```js
const MOCK_MODE = true;
```

---

## 6. Error handling

| Situation                | Message shown |
|--------------------------|---------------|
| Backend offline          | Unable to connect to Smart Xray AI server. Please make sure the Flask backend is running. |
| Model fails              | AI model could not process this X-ray. Please verify the model and try again. |
| Grad-CAM fails           | Could not generate the Grad-CAM heatmap for this X-ray. Please verify the model and try again. |
| Invalid model response   | Invalid model response. |
| Unsupported file         | Please upload a JPG, JPEG or PNG chest X-ray. |
| File too large           | File is too large. Maximum upload size is 15 MB. |

All of these use the app's existing toast / inline error panel (no `alert()`).

---

## 7. Security / file handling

- `secure_filename()` is used for the raw upload name; served filenames are
  server-generated (`XR-YYYY-NNNN.jpg`) — no user-controlled filesystem paths.
- `MAX_CONTENT_LENGTH = 15 MB` (returns HTTP 413 as JSON).
- Only `.jpg` / `.jpeg` / `.png` are accepted **and** the file is decoded with
  PIL to confirm it is a real image (rejects disguised files).
- Files are served with `send_from_directory`, which blocks path traversal.
- CORS is enabled with `flask-cors` for local frontend ↔ backend development.
- The backend filesystem is not exposed — only the two `/results/…` routes.

---

## 8. Notes

- **The trained model artifact is required.** It already exists at
  `backend/model/smart_xray_model.h5` (11.5 MB, produced by `train_model.py`).
  If it is missing or corrupt, the server still starts and
  `GET /api/health` reports `"model_loaded": false` with the error — no fake
  replacement is created.
- **Confidence ≠ precision.** Per-image confidence (e.g. `99.79%`) is the
  model's output probability for one X-ray. The dashboard's "Model
  Performance" (accuracy / sensitivity / specificity) figures are separate,
  clearly-labelled model-level benchmark placeholders — replace them with your
  model's real evaluation numbers from `train_model.py` before clinical use.
- This is a hackathon prototype: authentication is still mock (swap-ready in
  `frontend/js/auth.js` → `SX.loginUser`) and history persistence is
  localStorage-based on the frontend plus JSON sidecars in
  `backend/results/` on the backend.
- **Medical disclaimer:** Smart Xray is an AI-assisted screening tool and does
  not replace professional medical diagnosis.
