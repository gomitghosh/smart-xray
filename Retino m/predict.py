import os
import cv2
import torch
import pandas as pd
import numpy as np
import timm

from torch.utils.data import Dataset, DataLoader
import albumentations as A
from albumentations.pytorch import ToTensorV2
from tqdm import tqdm


# ============================================================
# CONFIG
# ============================================================

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

IMG_SIZE = 384
BATCH_SIZE = 8
NUM_CLASSES = 5

MODEL_NAME = "tf_efficientnet_b2"

TEST_CSV = "test.csv"
IMAGE_DIR = "test_images"
CHECKPOINT = "best_model.pth"


# ============================================================
# GPU
# ============================================================

print("=" * 60)
print("DEVICE:", DEVICE)

if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))
    print("CUDA:", torch.version.cuda)

print("=" * 60)


# ============================================================
# TEST DATA
# ============================================================

test_df = pd.read_csv(TEST_CSV)

print("Test images:", len(test_df))


# ============================================================
# TRANSFORM
# ============================================================

transform = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),

    A.Normalize(
        mean=(0.485, 0.456, 0.406),
        std=(0.229, 0.224, 0.225)
    ),

    ToTensorV2()
])


# ============================================================
# DATASET
# ============================================================

class TestDataset(Dataset):

    def __init__(self, dataframe, image_dir, transform):

        self.df = dataframe
        self.image_dir = image_dir
        self.transform = transform

    def __len__(self):

        return len(self.df)

    def __getitem__(self, idx):

        image_id = str(
            self.df.iloc[idx]["id_code"]
        )

        image_path = os.path.join(
            self.image_dir,
            image_id + ".png"
        )

        image = cv2.imread(image_path)

        if image is None:
            raise FileNotFoundError(
                f"Image not found: {image_path}"
            )

        image = cv2.cvtColor(
            image,
            cv2.COLOR_BGR2RGB
        )

        # Crop black borders
        gray = cv2.cvtColor(
            image,
            cv2.COLOR_RGB2GRAY
        )

        mask = gray > 10

        if np.any(mask):

            ys, xs = np.where(mask)

            x1 = max(xs.min() - 5, 0)
            x2 = min(xs.max() + 5, image.shape[1])

            y1 = max(ys.min() - 5, 0)
            y2 = min(ys.max() + 5, image.shape[0])

            image = image[y1:y2, x1:x2]

        image = self.transform(
            image=image
        )["image"]

        return image


# ============================================================
# DATALOADER
# ============================================================

dataset = TestDataset(
    test_df,
    IMAGE_DIR,
    transform
)

loader = DataLoader(
    dataset,
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=0,
    pin_memory=True
)


# ============================================================
# MODEL
# ============================================================

print("\nLoading model...")

model = timm.create_model(
    MODEL_NAME,
    pretrained=False,
    num_classes=NUM_CLASSES
)

checkpoint = torch.load(
    CHECKPOINT,
    map_location=DEVICE
)

model.load_state_dict(
    checkpoint["model_state_dict"]
)

model = model.to(DEVICE)

model.eval()

print("Model loaded.")
print("Checkpoint QWK:", checkpoint["qwk"])
print("Checkpoint epoch:", checkpoint["epoch"] + 1)


# ============================================================
# PREDICTION
# ============================================================

predictions = []

print("\nPredicting...")

with torch.no_grad():

    for images in tqdm(loader):

        images = images.to(
            DEVICE,
            non_blocking=True
        )

        outputs = model(images)

        preds = torch.argmax(
            outputs,
            dim=1
        )

        predictions.extend(
            preds.cpu().numpy()
        )


# ============================================================
# SUBMISSION
# ============================================================

submission = pd.DataFrame({
    "id_code": test_df["id_code"],
    "diagnosis": predictions
})

submission.to_csv(
    "submission.csv",
    index=False
)


# ============================================================
# SUMMARY
# ============================================================

print("\n" + "=" * 60)
print("PREDICTION COMPLETE")
print("=" * 60)

print("\nPrediction distribution:")
print(
    submission["diagnosis"]
    .value_counts()
    .sort_index()
)

print("\nFirst 10 predictions:")
print(submission.head(10))

print("\nSaved:")
print("submission.csv")