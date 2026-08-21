from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from PIL import Image
import io

# Import your working AI models!
from predict import load_xray_model, predict_pneumonia

app = FastAPI()

# This is the security pass that allows your HTML to talk to Python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the AI model once when the server starts
model = load_xray_model("smart_xray_model.h5")

@app.post("/predict")
async def analyze_xray(file: UploadFile = File(...)):
    # 1. Read the uploaded image from the HTML website
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    
    # 2. Run the AI Prediction
    label, confidence, preprocessed_arr = predict_pneumonia(image, model)
    risk = "High" if "PNEUMONIA" in label.upper() else "Low"
    
    # 3. Send the results back to the HTML dashboard
    return {
        "prediction": label,
        "confidence": round(confidence * 100, 2),
        "risk": risk
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)