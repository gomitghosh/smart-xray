import cv2
import torch
import timm
import numpy as np

from PIL import Image
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.image import (
    show_cam_on_image,
    preprocess_image
)


# ============================================================
# SETTINGS
# ============================================================

IMAGE_PATH = "test_images/1a0a62061725.png"
MODEL_PATH = "best_model.pth"

IMG_SIZE = 384

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available() else "cpu"
)


# ============================================================
# LOAD MODEL
# ============================================================

model = timm.create_model(
    "tf_efficientnet_b2",
    pretrained=False,
    num_classes=5
)

checkpoint = torch.load(
    MODEL_PATH,
    map_location=DEVICE
)

model.load_state_dict(
    checkpoint["model_state_dict"]
)

model = model.to(DEVICE)
model.eval()


# ============================================================
# LOAD IMAGE
# ============================================================

image = cv2.imread(IMAGE_PATH)

if image is None:
    raise FileNotFoundError(IMAGE_PATH)

image = cv2.cvtColor(
    image,
    cv2.COLOR_BGR2RGB
)

# Keep a copy for visualization
original = image.copy()

# Resize
image_resized = cv2.resize(
    image,
    (IMG_SIZE, IMG_SIZE)
)

# Convert to float 0-1
rgb_float = image_resized.astype(
    np.float32
) / 255.0


# ============================================================
# PREPARE IMAGE FOR MODEL
# ============================================================

input_tensor = preprocess_image(
    image_resized,
    mean=[0.485, 0.456, 0.406],
    std=[0.229, 0.224, 0.225]
)

input_tensor = input_tensor.to(DEVICE)


# ============================================================
# FIND EFFICIENTNET TARGET LAYER
# ============================================================

target_layer = model.conv_head


# ============================================================
# GRAD-CAM
# ============================================================

cam = GradCAM(
    model=model,
    target_layers=[target_layer]
)

grayscale_cam = cam(
    input_tensor=input_tensor
)[0]


# ============================================================
# CREATE HEATMAP
# ============================================================

visualization = show_cam_on_image(
    rgb_float,
    grayscale_cam,
    use_rgb=True
)


# ============================================================
# PREDICTION
# ============================================================

with torch.no_grad():

    output = model(
        input_tensor
    )

    probabilities = torch.softmax(
        output,
        dim=1
    )

    prediction = torch.argmax(
        probabilities,
        dim=1
    ).item()

    confidence = probabilities[
        0,
        prediction
    ].item()


print("=" * 50)
print("Prediction:", prediction)
print(
    "Confidence:",
    f"{confidence * 100:.2f}%"
)
print("=" * 50)


# ============================================================
# SAVE RESULT
# ============================================================

output_path = "gradcam_result.jpg"

cv2.imwrite(
    output_path,
    cv2.cvtColor(
        visualization,
        cv2.COLOR_RGB2BGR
    )
)

print(
    "Saved:",
    output_path
)