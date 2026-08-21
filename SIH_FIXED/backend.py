from pathlib import Path
import base64
import os
import tempfile
from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from gradcam import analyze_xray


BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Smart X-Ray AI API")


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "Finalapp.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a valid X-ray image."
        )

    suffix = Path(file.filename or "xray.jpg").suffix or ".jpg"
    temp_path = None

    try:
        contents = await file.read()

        if not contents:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty."
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix
        ) as temp:
            temp.write(contents)
            temp_path = temp.name

        result = analyze_xray(temp_path)

        overlay_image = Image.fromarray(result["overlay"])

        buffer = BytesIO()
        overlay_image.save(
            buffer,
            format="JPEG",
            quality=90
        )

        encoded_gradcam = base64.b64encode(
            buffer.getvalue()
        ).decode("utf-8")

        return {
            "prediction": result["result"],
            "confidence": round(result["confidence"] * 100, 2),
            "gradcam": encoded_gradcam
        }

    except HTTPException:
        raise

    except Exception as exc:
        print("AI ANALYSIS ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail=f"AI analysis failed: {str(exc)}"
        )

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
