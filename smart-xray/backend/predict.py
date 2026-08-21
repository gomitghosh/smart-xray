import tensorflow as tf
import numpy as np
from tensorflow.keras.preprocessing import image

IMG_SIZE = 224

def load_xray_model(model_path="smart_xray_model.h5"):
    return tf.keras.models.load_model(model_path)

def predict_pneumonia(img, model):
    # 1. Resize the PIL image passed from Streamlit
    img = img.resize((IMG_SIZE, IMG_SIZE))
    
    # 2. Convert to array and normalize
    img_array = image.img_to_array(img)
    img_array = img_array / 255.0
    
    # 3. Add batch dimension
    img_array = np.expand_dims(img_array, axis=0)
    
    # 4. Cast to tensor (so Grad-CAM can use it later)
    img_tensor = tf.cast(img_array, tf.float32)
    
    # 5. Run prediction
    predictions = model.predict(img_tensor)
    probability = float(predictions[0][0])
    
    if probability >= 0.5:
        result = "PNEUMONIA"
        confidence = probability
    else:
        result = "NORMAL"
        confidence = 1 - probability
        
    # Return exactly the 3 variables app.py is asking for
    return result, confidence, img_tensor