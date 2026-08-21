import streamlit as st
from PIL import Image
from datetime import datetime
import time

# --- ADD THESE NEW IMPORTS ---
from predict import load_xray_model, predict_pneumonia
from gradcam import generate_gradcam_heatmap, overlay_heatmap

# --- LOAD MODEL ONCE ---
@st.cache_resource
def get_model():
    # Make sure this matches the filename saved by train_model.py
    return load_xray_model("smart_xray_model.h5")

model = get_model()

# ============================================================
# SMART X-RAY - FRONTEND
# Member 3: Frontend / Streamlit
# ============================================================

st.set_page_config(
    page_title="Smart X-Ray",
    page_icon="🩻",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ============================================================
# CUSTOM CSS
# ============================================================

st.markdown("""
<style>

    /* Captions */
    .stApp .stCaption,
    .stApp [data-testid="stCaptionContainer"] {
        color: #64748b !important;
    }

    /* ========================================================
       FIX INPUT FIELD COLORS
       ======================================================== */
    /* Force input boxes to have a light background and dark text */
    .stApp .stTextInput input,
    .stApp .stNumberInput input,
    .stApp .stSelectbox div[data-baseweb="select"] {
        background-color: #f8fafc !important;
        color: #0f172a !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 6px !important;
    }
    
    /* Fix the text color inside the file uploader drop zone */
    .stApp [data-testid="stFileUploadDropzone"] {
        background-color: #f8fafc !important;
    }
    .stApp [data-testid="stFileUploadDropzone"] * {
        color: #0f172a !important;
    }

</style>
    
</style>

""", unsafe_allow_html=True)


# ============================================================
# SESSION STATE
# ============================================================

if "page" not in st.session_state:
    st.session_state.page = "Dashboard"

if "result" not in st.session_state:
    st.session_state.result = None

if "scan_count" not in st.session_state:
    st.session_state.scan_count = 0


# ============================================================
# SIDEBAR
# ============================================================

# ============================================================
# SIDEBAR
# ============================================================

with st.sidebar:
    st.markdown("## SMART X-RAY")
    st.caption("AI-Assisted X-Ray Screening")
    st.markdown("---")
    
    st.markdown("### Operator Details")
    op_name = st.text_input("Name", value="Saloni baria")
    op_class = st.text_input("Class/Semester", value="B.Tech 2nd Semester")
    op_enrol = st.text_input("Enrolment Number")
    
    # Save to session state so they persist across pages
    st.session_state.operator = {
        "name": op_name,
        "class": op_class,
        "enrolment": op_enrol
    }
    
    st.markdown("---")
    
    # NAVIGATION BUTTONS
    if st.button("Dashboard"):
        st.session_state.page = "Dashboard"
        st.rerun()

    if st.button("New Analysis"):
        st.session_state.page = "New Analysis"
        st.rerun()

    if st.button("Reports"):
        st.session_state.page = "Reports"
        st.rerun()

# ============================================================
# DASHBOARD
# ============================================================

if st.session_state.page == "Dashboard":

    st.markdown("### System Status")
    st.success("● AI System Online")

    st.markdown("---")
    
    st.caption("Smart X-Ray")
    st.caption("SIH 2026 Prototype")
    
    # Statistics
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.markdown(
            f"""
            <div class="card">
                <div class="stat-label">Total Scans</div>
                <div class="stat-number">{st.session_state.scan_count}</div>
            </div>
            """,
            unsafe_allow_html=True
        )

    with col2:
        st.markdown(
            """
            <div class="card">
                <div class="stat-label">AI Status</div>
                <div class="stat-number">Online</div>
            </div>
            """,
            unsafe_allow_html=True
        )

    with col3:
        st.markdown(
            """
            <div class="card">
                <div class="stat-label">Analysis Type</div>
                <div class="stat-number">Chest X-Ray</div>
            </div>
            """,
            unsafe_allow_html=True
        )

    with col4:
        st.markdown(
            """
            <div class="card">
                <div class="stat-label">Platform</div>
                <div class="stat-number">Smart X-Ray</div>
            </div>
            """,
            unsafe_allow_html=True
        )

    st.markdown("###")

    col1, col2 = st.columns([1.4, 1])

    with col1:
        st.markdown(
            """
            <div class="card">
                <div class="card-title">AI-Powered Screening</div>
            </div>
            """,
            unsafe_allow_html=True
        )

        st.write("Smart X-Ray assists in the preliminary analysis of chest X-ray images using artificial intelligence.")
        st.write("Upload an X-ray image to receive an AI-generated screening result and confidence score.")

        if st.button("Start New X-Ray Analysis"):
            st.session_state.page = "New Analysis"
            st.rerun()

    with col2:
        st.markdown(
            """
            <div class="card">
                <div class="card-title">Screening Workflow</div>
            </div>
            """,
            unsafe_allow_html=True
        )

        st.write("1. Upload chest X-ray")
        st.write("2. AI analyzes the image")
        st.write("3. Screening prediction is generated")
        st.write("4. Review the screening result")
        st.write("5. Generate screening report")
# ============================================================
# NEW ANALYSIS
# ============================================================

if st.session_state.page == "New Analysis":

    st.markdown(
        '<div class="main-title">New X-Ray Analysis</div>',
        unsafe_allow_html=True
    )

    st.markdown(
        '<div class="subtitle">Enter patient information and upload a chest X-ray</div>',
        unsafe_allow_html=True
    )

    # Patient information
    st.markdown("### Patient Information")

    col1, col2, col3 = st.columns(3)

    with col1:
        patient_id = st.text_input(
            "Patient ID",
            placeholder="e.g. PX-1024"
        )

    with col2:
        age = st.number_input(
            "Age",
            min_value=1,
            max_value=120,
            value=30
        )

    with col3:
        gender = st.selectbox(
            "Gender",
            ["Male", "Female", "Other"]
        )

    st.markdown("### Upload X-Ray")

    uploaded_file = st.file_uploader(
        "Upload chest X-ray image",
        type=["jpg", "jpeg", "png"],
        help="Supported formats: JPG, JPEG, PNG"
    )

    if uploaded_file:

        image = Image.open(uploaded_file)

        col1, col2 = st.columns([1.3, 1])

        with col1:

            st.markdown("#### X-Ray Preview")

            st.image(
                image,
                caption="Uploaded Chest X-Ray",
                use_container_width=True
            )

        with col2:

            st.markdown(
                """
                <div class="card">
                    <div class="card-title">Scan Information</div>
                </div>
                """,
                unsafe_allow_html=True
            )

            st.write("**File:**", uploaded_file.name)
            st.write("**Format:**", uploaded_file.type)
            st.write(
                "**Image Size:**",
                f"{image.width} × {image.height}"
            )

            st.markdown("---")

            analyze = st.button("🔍 RUN AI ANALYSIS", type="primary")

            if analyze:
                if not patient_id:
                    st.warning("Please enter a Patient ID.")
                else:
                    with st.spinner("AI is analyzing the X-ray and computing activation maps..."):
                        
                        # 1. Run the Prediction (Member 1)
                        label, confidence, preprocessed_arr = predict_pneumonia(image, model)
                        
                        # 2. Generate the Heatmap (Member 2)
                        heatmap = generate_gradcam_heatmap(preprocessed_arr, model)
                        heatmap_overlay = overlay_heatmap(image, heatmap)
                        
                        # 3. Format the Risk Logic
                        risk = "High" if "PNEUMONIA" in label.upper() else "Low"
                        finding = "High opacity detected in pulmonary regions." if risk == "High" else "No significant abnormality detected by the AI model."

                        # 4. Save to Session State
                        st.session_state.result = {
                            "patient_id": patient_id,
                            "age": age,
                            "gender": gender,
                            "filename": uploaded_file.name,
                            "date": datetime.now().strftime("%d %b %Y, %I:%M %p"),
                            "prediction": label,
                            "confidence": round(confidence * 100, 2),
                            "risk": risk,
                            "finding": finding,
                            "original_image": image,           
                            "heatmap_image": heatmap_overlay   
                        }

                        st.session_state.scan_count += 1
                        
                        # Automatically transition to the Results page!
                        st.session_state.page = "Result"
                        st.rerun()

# ============================================================
# RESULT PAGE
# ============================================================

# ============================================================
# RESULT PAGE
# ============================================================

elif st.session_state.page == "Result":

    # Get the stored analysis result
    result = st.session_state.result

    # IMPORTANT:
    # This IF block must be INSIDE the Result page block.
    if result is None:

        st.warning("No analysis available.")

        if st.button("Start Analysis"):
            st.session_state.page = "New Analysis"
            st.rerun()

    else:

        st.markdown(
            '<div class="main-title">Analysis Result</div>',
            unsafe_allow_html=True
        )

        st.markdown(
            '<div class="subtitle">AI-assisted screening report</div>',
            unsafe_allow_html=True
        )

        # ========================================================
        # PATIENT DETAILS
        # ========================================================

        st.markdown("### Patient Details")

        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Patient ID", result["patient_id"])

        with col2:
            st.metric("Age", result["age"])

        with col3:
            st.metric("Gender", result["gender"])

        with col4:
            st.metric("Scan Date", result["date"])

        st.markdown("###")

        # ========================================================
        # X-RAY AND AI ASSESSMENT
        # ========================================================
        
        col1, col2 = st.columns([1.2, 1])

        with col1:
            st.markdown("### 🩻 X-Ray Analysis")
            
            # Show Original and Heatmap stacked or side-by-side
            sub_col1, sub_col2 = st.columns(2)
            
            with sub_col1:
                st.write("**Original Scan**")
                st.image(result["original_image"], use_container_width=True)
                
            with sub_col2:
                st.write("**AI Heatmap (Grad-CAM)**")
                st.image(result["heatmap_image"], use_container_width=True)
                
            st.caption("🔴 Red/Yellow regions highlight the lung opacities influencing the AI decision.")
            
        with col2:
            st.markdown(
                """
                <div class="result-box">
                    <div class="result-title">
                        AI Assessment
                    </div>
                </div>
                """,
                unsafe_allow_html=True
            )

            prediction = result["prediction"]
            confidence = result["confidence"]
            risk = result["risk"]
            finding = result["finding"]

            st.markdown("###")
            st.metric("Prediction", prediction)
            st.markdown(f'<div class="confidence">{confidence}%</div>', unsafe_allow_html=True)
            st.caption("AI Confidence")
            st.progress(confidence / 100)
            st.write("**Risk Level:**", risk)
            st.write("**Finding:**")
            st.write(finding)

        st.markdown("###")

        # ========================================================
        # SCREENING RESULT MESSAGE
        # ========================================================

        if risk.lower() == "low":
            st.markdown(
                """
                <div class="success">
                    <b>Screening Result:</b>
                    No significant abnormality detected by the AI screening model.
                </div>
                """,
                unsafe_allow_html=True
            )
        else:
            st.markdown(
                """
                <div class="warning">
                    <b>Attention:</b>
                    The AI system detected a possible abnormality.
                    Further evaluation by a qualified medical professional is recommended.
                </div>
                """,
                unsafe_allow_html=True
            )

        # ========================================================
        # MEDICAL DISCLAIMER
        # ========================================================

        st.markdown("### Medical Disclaimer")
        st.info(
            "Smart X-Ray is an AI-assisted screening prototype. "
            "Its results are not a medical diagnosis and should not "
            "replace evaluation by a qualified healthcare professional."
        )

        # ========================================================
        # ACTION BUTTONS
        # ========================================================

        col1, col2 = st.columns(2)

        with col1:
            if st.button("← New Analysis"):
                st.session_state.page = "New Analysis"
                st.rerun()

        with col2:
            # Get operator details from sidebar
            operator = st.session_state.get("operator", {"name": "", "class": "", "enrolment": ""})

            # Create report text
            report_text = f"""
SMART X-RAY
AI-Assisted X-Ray Screening Report

=========================================
OPERATOR DETAILS
Name: {operator['name']}
Class: {operator['class']}
Enrolment No: {operator['enrolment']}
=========================================

PATIENT DETAILS
Patient ID: {result["patient_id"]}
Age: {result["age"]}
Gender: {result["gender"]}
Date: {result["date"]}

=========================================
AI DIAGNOSTIC RESULT
Prediction: {result["prediction"]}
Confidence: {result["confidence"]}%
Risk Level: {result["risk"]}

Finding:
{result["finding"]}

=========================================
DISCLAIMER:
This is an AI-assisted screening result and not a medical diagnosis.
"""
            st.download_button(
                "📄 Download Report",
                data=report_text,
                file_name=f"{result['patient_id']}_report.txt",
                mime="text/plain"
            )


# ============================================================
# REPORTS
# ============================================================
elif st.session_state.page == "Reports":

    st.markdown(
        '<div class="main-title">Reports</div>',
        unsafe_allow_html=True
    )

    st.markdown(
        '<div class="subtitle">Previously generated screening reports</div>',
        unsafe_allow_html=True
    )

    if st.session_state.result:

        result = st.session_state.result

        st.markdown(
            """
            <div class="card">
                <div class="card-title">Latest Analysis</div>
            </div>
            """,
            unsafe_allow_html=True
        )

        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.write("**Patient ID**")
            st.write(result["patient_id"])

        with col2:
            st.write("**Prediction**")
            st.write(result["prediction"])

        with col3:
            st.write("**Confidence**")
            st.write(f'{result["confidence"]}%')

        with col4:
            st.write("**Risk**")
            st.write(result["risk"])

        st.markdown("---")

        if st.button("View Full Report"):
            st.session_state.page = "Result"
            st.rerun()

    else:
        st.info(
            "No reports have been generated yet. "
            "Complete an X-ray analysis to create a report."
        )