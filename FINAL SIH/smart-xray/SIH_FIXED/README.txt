# Smart X-Ray — Fixed AI/Grad-CAM Web Pipeline

Put these files in the SAME folder as `smart_xray_model.h5`:

- Finalapp.html
- backend.py
- gradcam.py
- requirements.txt
- smart_xray_model.h5

Install dependencies:

    pip install -r requirements.txt

Run:

    uvicorn backend:app --reload

Open:

    http://127.0.0.1:8000

Then upload an X-ray and click `Execute AI Diagnosis`.

The webpage now sends the uploaded image to `/analyze`, which runs the `.h5` model and generates Grad-CAM in Python. The old hard-coded 94.8% result and browser-generated fake heatmap have been removed.

Important: this is a prototype screening/triage tool, not a clinically validated diagnostic device.
