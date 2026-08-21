import os
import numpy as np
import tensorflow as tf

from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.models import Model
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D, Dropout
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
from sklearn.metrics import classification_report, confusion_matrix


# =========================
# SETTINGS
# =========================

IMG_SIZE = 224
BATCH_SIZE = 32

TRAIN_DIR = "dataset/train"
VAL_DIR = "dataset/val"
TEST_DIR = "dataset/test"

MODEL_PATH = "smart_xray_model.h5"


# =========================
# DATA GENERATORS
# =========================

train_datagen = ImageDataGenerator(
    rescale=1.0 / 255,
    rotation_range=10,
    width_shift_range=0.05,
    height_shift_range=0.05,
    zoom_range=0.10,
    horizontal_flip=True
)

val_test_datagen = ImageDataGenerator(
    rescale=1.0 / 255
)


train_data = train_datagen.flow_from_directory(
    TRAIN_DIR,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="binary",
    shuffle=True
)

val_data = val_test_datagen.flow_from_directory(
    VAL_DIR,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="binary",
    shuffle=False
)

test_data = val_test_datagen.flow_from_directory(
    TEST_DIR,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="binary",
    shuffle=False
)


print("\nClass mapping:")
print(train_data.class_indices)


# =========================
# BASE MODEL
# =========================

base_model = MobileNetV2(
    weights="imagenet",
    include_top=False,
    input_shape=(IMG_SIZE, IMG_SIZE, 3)
)

base_model.trainable = False


# =========================
# CLASSIFIER
# =========================

x = base_model.output

x = GlobalAveragePooling2D()(x)

x = Dense(128, activation="relu")(x)

x = Dropout(0.3)(x)

output = Dense(1, activation="sigmoid")(x)


model = Model(
    inputs=base_model.input,
    outputs=output
)


# =========================
# COMPILE
# =========================

model.compile(
    optimizer=Adam(learning_rate=0.0001),
    loss="binary_crossentropy",
    metrics=[
        "accuracy",
        tf.keras.metrics.Precision(name="precision"),
        tf.keras.metrics.Recall(name="recall")
    ]
)


model.summary()


# =========================
# CALLBACKS
# =========================

callbacks = [

    EarlyStopping(
        monitor="val_loss",
        patience=3,
        restore_best_weights=True
    ),

    ModelCheckpoint(
        MODEL_PATH,
        monitor="val_loss",
        save_best_only=True
    )
]


# =========================
# TRAIN
# =========================

history = model.fit(
    train_data,
    validation_data=val_data,
    epochs=10,
    callbacks=callbacks
)


# =========================
# TEST EVALUATION
# =========================

print("\nEvaluating model on test data...")

results = model.evaluate(test_data)

print("\nTest Results:")

for name, value in zip(model.metrics_names, results):
    print(f"{name}: {value:.4f}")


# =========================
# CLASSIFICATION REPORT
# =========================

test_data.reset()

predictions = model.predict(test_data)

predicted_classes = (predictions >= 0.5).astype(int).flatten()

true_classes = test_data.classes

class_names = list(test_data.class_indices.keys())

print("\nClassification Report:\n")

print(
    classification_report(
        true_classes,
        predicted_classes,
        target_names=class_names
    )
)


# =========================
# CONFUSION MATRIX
# =========================

print("\nConfusion Matrix:\n")

print(
    confusion_matrix(
        true_classes,
        predicted_classes
    )
)


# =========================
# SAVE FINAL MODEL
# =========================

model.save(MODEL_PATH)

print("\nModel saved as:", MODEL_PATH)

print("\nClass mapping:", test_data.class_indices)
