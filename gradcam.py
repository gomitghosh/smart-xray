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

    # Return as a PIL Image so Streamlit can easily display it
    return Image.fromarray(superimposed_img)