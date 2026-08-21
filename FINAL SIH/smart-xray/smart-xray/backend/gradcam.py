import tensorflow as tf
import numpy as np
from PIL import Image
import matplotlib as mpl

def generate_gradcam_heatmap(img_tensor, model, last_conv_layer_name="out_relu"):
    """Generates the raw Grad-CAM heatmap."""

    # Create a model that outputs the conv layer and the predictions
    grad_model = tf.keras.models.Model(
        inputs=[model.inputs],
        outputs=[model.get_layer(last_conv_layer_name).output, model.output]
    )

    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_tensor)
        pneumonia_probability = predictions[:, 0]

    # Calculate gradients
    grads = tape.gradient(pneumonia_probability, conv_outputs)

    # Average gradients across width and height
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    # Weight feature maps using gradients
    conv_outputs = conv_outputs[0]
    heatmap = tf.reduce_sum(conv_outputs * pooled_grads, axis=-1)

    # Keep only positive influence and normalize
    heatmap = tf.maximum(heatmap, 0)
    max_value = tf.reduce_max(heatmap)
    if max_value > 0:
        heatmap /= max_value

    return heatmap.numpy()


def overlay_heatmap(image_input, heatmap, alpha=0.45):
    """Overlays the heatmap onto the original X-ray."""

    # Check if input is a file path or already an image array
    if isinstance(image_input, str):
        original_image = Image.open(image_input).convert("RGB")
        original_image_array = np.array(original_image)
    else:
        original_image_array = np.array(image_input)
        # Convert grayscale to RGB if necessary
        if len(original_image_array.shape) == 2:
            original_image_array = np.stack((original_image_array,)*3, axis=-1)

    # Rescale heatmap and resize to match original image
    heatmap_img = Image.fromarray(np.uint8(heatmap * 255))
    heatmap_img = heatmap_img.resize((original_image_array.shape[1], original_image_array.shape[0]))
    heatmap_array = np.array(heatmap_img)

    # Colorize the heatmap using the 'jet' colormap (UPDATED COMMAND)
    jet = mpl.colormaps["jet"]
    jet_colors = jet(np.arange(256))[:, :3]
    colorized_heatmap = jet_colors[heatmap_array] * 255

    # Superimpose the heatmap on the original image
    superimposed_img = colorized_heatmap * alpha + original_image_array
    superimposed_img = np.clip(superimposed_img, 0, 255).astype(np.uint8)

    # Return as a PIL Image so the Flask API can easily save it
    return Image.fromarray(superimposed_img)


def generate_gradcam(image_path, model, output_path,
                     target_size=(224, 224),
                     last_conv_layer_name="out_relu",
                     alpha=0.45):
    """
    End-to-end Grad-CAM for a single X-ray image — reusable from the Flask API.

    Parameters
    ----------
    image_path  : str
        Filesystem path of the uploaded chest X-ray.
    model       : tf.keras.Model
        The trained model, already loaded once by app.py.
    output_path : str
        Where the superimposed (coloured) Grad-CAM image is saved.
    target_size : tuple
        Model input size — MUST match the size used during training (224).
    last_conv_layer_name : str
        The convolutional/ReLU layer used for Grad-CAM (default matches the
        MobileNetV2 used in train_model.py).

    Returns
    -------
    output_path : str
    """
    # 1. Preprocess identically to training (resize 224x224, rescale 1/255)
    #    — mirrors the preprocessing in predict.py / train_model.py.
    img = Image.open(image_path).convert("RGB")
    img_array = np.asarray(img.resize(target_size), dtype=np.float32) / 255.0
    img_tensor = tf.cast(np.expand_dims(img_array, axis=0), tf.float32)

    # 2. Raw Grad-CAM heatmap (the model's attention for the pneumonia class)
    heatmap = generate_gradcam_heatmap(img_tensor, model, last_conv_layer_name)

    # 3. Colour-map and overlay onto the ORIGINAL-resolution image
    overlay = overlay_heatmap(image_path, heatmap, alpha=alpha)

    # 4. Save the result
    overlay.save(output_path)
    return output_path
