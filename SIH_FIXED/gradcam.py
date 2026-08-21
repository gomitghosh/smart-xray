import os
from pathlib import Path

import cv2
import numpy as np
import tensorflow as tf
from PIL import Image


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "smart_xray_model.h5"
IMG_SIZE = 224
LAST_CONV_LAYER = "out_relu"


# Load once when the backend starts.
print("Loading AI model...")
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("AI model loaded successfully.")


# Build the Grad-CAM model once.
try:
    last_conv = model.get_layer(LAST_CONV_LAYER)
except ValueError:
    # Fallback: find the last layer that has a 4-D feature-map output.
    candidates = []
    for layer in model.layers:
        try:
            shape = layer.output.shape
            if len(shape) == 4:
                candidates.append(layer)
        except Exception:
            pass

    if not candidates:
        raise RuntimeError(
            "Could not find a convolutional feature-map layer for Grad-CAM."
        )

    last_conv = candidates[-1]

print("Grad-CAM layer:", last_conv.name)

grad_model = tf.keras.models.Model(
    inputs=model.inputs,
    outputs=[last_conv.output, model.output]
)


def analyze_xray(image_path):
    """
    Run the trained model and generate a real Grad-CAM overlay.

    Returns:
        {
            "result": "PNEUMONIA" or "NORMAL",
            "confidence": float from 0 to 1,
            "overlay": RGB uint8 numpy array
        }
    """

    original = Image.open(image_path).convert("RGB")
    original_array = np.array(original)

    height, width = original_array.shape[:2]

    # Same basic preprocessing used by the existing project:
    # resize to 224x224 and scale pixels to 0..1.
    resized = original.resize((IMG_SIZE, IMG_SIZE))
    img_array = np.asarray(resized).astype("float32") / 255.0
    img_array = np.expand_dims(img_array, axis=0)

    img_tensor = tf.convert_to_tensor(img_array, dtype=tf.float32)

    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_tensor)

        # Existing model is a sigmoid binary classifier.
        score = predictions[:, 0]

    gradients = tape.gradient(score, conv_outputs)

    if gradients is None:
        raise RuntimeError(
            "Grad-CAM gradients were not produced. "
            "Check the selected convolutional layer."
        )

    pooled_gradients = tf.reduce_mean(
        gradients,
        axis=(0, 1, 2)
    )

    conv_outputs = conv_outputs[0]

    heatmap = tf.reduce_sum(
        conv_outputs * pooled_gradients,
        axis=-1
    )

    heatmap = tf.maximum(heatmap, 0)

    max_value = tf.reduce_max(heatmap)

    if float(max_value) > 0:
        heatmap = heatmap / max_value

    heatmap = heatmap.numpy()

    probability = float(predictions[0][0])

    if probability >= 0.5:
        result = "PNEUMONIA"
        confidence = probability
    else:
        result = "NORMAL"
        confidence = 1.0 - probability

    # Resize activation map to original X-ray size.
    heatmap = cv2.resize(
        heatmap,
        (width, height),
        interpolation=cv2.INTER_LINEAR
    )

    heatmap_uint8 = np.uint8(np.clip(heatmap, 0, 1) * 255)

    # JET heatmap.
    colored_heatmap = cv2.applyColorMap(
        heatmap_uint8,
        cv2.COLORMAP_JET
    )

    colored_heatmap = cv2.cvtColor(
        colored_heatmap,
        cv2.COLOR_BGR2RGB
    )

    # Blend real Grad-CAM with original X-ray.
    overlay = cv2.addWeighted(
        original_array,
        0.60,
        colored_heatmap,
        0.40,
        0
    )

    return {
        "result": result,
        "confidence": confidence,
        "overlay": overlay
    }
