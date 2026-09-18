import os
import random
import numpy as np
import pandas as pd
import cv2

from sklearn.model_selection import train_test_split
from sklearn.metrics import cohen_kappa_score, classification_report

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler

import timm
import albumentations as A
from albumentations.pytorch import ToTensorV2

from tqdm import tqdm


# ============================================================
# GPU
# ============================================================

if torch.cuda.is_available():
    DEVICE = torch.device("cuda")

    print("=" * 60)
    print("GPU ENABLED")
    print("GPU:", torch.cuda.get_device_name(0))
    print("CUDA:", torch.version.cuda)
    print("=" * 60)

else:
    DEVICE = torch.device("cpu")

    print("=" * 60)
    print("WARNING: CUDA NOT AVAILABLE - USING CPU")
    print("=" * 60)


# ============================================================
# CONFIG
# ============================================================

IMG_SIZE = 384
BATCH_SIZE = 8
EPOCHS = 15
LR = 2e-4
NUM_CLASSES = 5

MODEL_NAME = "tf_efficientnet_b2"

TRAIN_CSV = "train.csv"
IMAGE_DIR = "train_images"


# ============================================================
# SEED
# ============================================================

def seed_everything(seed=42):

    random.seed(seed)
    np.random.seed(seed)

    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


seed_everything()


# ============================================================
# LOAD CSV
# ============================================================

df = pd.read_csv(TRAIN_CSV)

print("\nDataset shape:", df.shape)

print("\nClass distribution:")
print(df["diagnosis"].value_counts().sort_index())


# ============================================================
# TRAIN / VALIDATION SPLIT
# ============================================================

train_df, val_df = train_test_split(
    df,
    test_size=0.20,
    stratify=df["diagnosis"],
    random_state=42
)

train_df = train_df.reset_index(drop=True)
val_df = val_df.reset_index(drop=True)

print("\nTraining images:", len(train_df))
print("Validation images:", len(val_df))


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

def crop_black(image):

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_RGB2GRAY
    )

    mask = gray > 10

    if not np.any(mask):
        return image

    ys, xs = np.where(mask)

    x1 = max(xs.min() - 5, 0)
    x2 = min(xs.max() + 5, image.shape[1])

    y1 = max(ys.min() - 5, 0)
    y2 = min(ys.max() + 5, image.shape[0])

    return image[y1:y2, x1:x2]


# ============================================================
# AUGMENTATION
# ============================================================

train_transform = A.Compose([

    A.Resize(
        IMG_SIZE,
        IMG_SIZE
    ),

    A.HorizontalFlip(p=0.5),

    A.RandomRotate90(p=0.3),

    A.ShiftScaleRotate(
        shift_limit=0.05,
        scale_limit=0.10,
        rotate_limit=15,
        p=0.5
    ),

    A.RandomBrightnessContrast(
        brightness_limit=0.15,
        contrast_limit=0.15,
        p=0.4
    ),

    A.GaussianBlur(
        blur_limit=(3, 5),
        p=0.1
    ),

    A.Normalize(
        mean=(0.485, 0.456, 0.406),
        std=(0.229, 0.224, 0.225)
    ),

    ToTensorV2()
])


val_transform = A.Compose([

    A.Resize(
        IMG_SIZE,
        IMG_SIZE
    ),

    A.Normalize(
        mean=(0.485, 0.456, 0.406),
        std=(0.229, 0.224, 0.225)
    ),

    ToTensorV2()
])


# ============================================================
# DATASET
# ============================================================

class APTOSDataset(Dataset):

    def __init__(
        self,
        dataframe,
        image_dir,
        transform=None
    ):

        self.df = dataframe
        self.image_dir = image_dir
        self.transform = transform

    def __len__(self):

        return len(self.df)

    def __getitem__(self, idx):

        row = self.df.iloc[idx]

        image_id = str(row["id_code"])
        label = int(row["diagnosis"])

        image_path = os.path.join(
            self.image_dir,
            image_id + ".png"
        )

        image = cv2.imread(image_path)

        if image is None:

            raise FileNotFoundError(
                f"Could not find: {image_path}"
            )

        image = cv2.cvtColor(
            image,
            cv2.COLOR_BGR2RGB
        )

        image = crop_black(image)

        if self.transform:

            image = self.transform(
                image=image
            )["image"]

        return image, label


# ============================================================
# DATASETS
# ============================================================

train_dataset = APTOSDataset(
    train_df,
    IMAGE_DIR,
    train_transform
)

val_dataset = APTOSDataset(
    val_df,
    IMAGE_DIR,
    val_transform
)


# ============================================================
# CLASS BALANCING
# ============================================================

class_counts = (
    train_df["diagnosis"]
    .value_counts()
    .sort_index()
)

class_weights = 1.0 / class_counts.values

sample_weights = [
    class_weights[label]
    for label in train_df["diagnosis"]
]

sampler = WeightedRandomSampler(
    weights=torch.DoubleTensor(sample_weights),
    num_samples=len(sample_weights),
    replacement=True
)


# ============================================================
# DATALOADERS
# ============================================================

train_loader = DataLoader(
    train_dataset,
    batch_size=BATCH_SIZE,
    sampler=sampler,
    num_workers=0,
    pin_memory=True
)

val_loader = DataLoader(
    val_dataset,
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=0,
    pin_memory=True
)


# ============================================================
# MODEL
# ============================================================

print("\nLoading EfficientNet-B2...")

model = timm.create_model(
    MODEL_NAME,
    pretrained=True,
    num_classes=NUM_CLASSES
)

model = model.to(DEVICE)

print("Model loaded on:", DEVICE)


# ============================================================
# LOSS
# ============================================================

criterion = nn.CrossEntropyLoss()


# ============================================================
# OPTIMIZER
# ============================================================

optimizer = torch.optim.AdamW(
    model.parameters(),
    lr=LR,
    weight_decay=1e-4
)


scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
    optimizer,
    T_max=EPOCHS
)


# ============================================================
# TRAIN
# ============================================================

best_qwk = -1


for epoch in range(EPOCHS):

    print("\n")
    print("=" * 60)
    print(f"EPOCH {epoch + 1}/{EPOCHS}")
    print("=" * 60)


    # --------------------------------------------------------
    # TRAINING
    # --------------------------------------------------------

    model.train()

    running_loss = 0.0

    progress = tqdm(
        train_loader,
        desc="Training"
    )

    for images, labels in progress:

        images = images.to(
            DEVICE,
            non_blocking=True
        )

        labels = labels.to(
            DEVICE,
            non_blocking=True
        )

        optimizer.zero_grad()

        outputs = model(images)

        loss = criterion(
            outputs,
            labels
        )

        loss.backward()

        optimizer.step()

        running_loss += loss.item()

        progress.set_postfix(
            loss=f"{loss.item():.4f}"
        )


    train_loss = (
        running_loss /
        len(train_loader)
    )


    scheduler.step()


    # --------------------------------------------------------
    # VALIDATION
    # --------------------------------------------------------

    model.eval()

    val_loss = 0.0

    all_labels = []
    all_predictions = []


    with torch.no_grad():

        for images, labels in tqdm(
            val_loader,
            desc="Validation"
        ):

            images = images.to(DEVICE)
            labels = labels.to(DEVICE)

            outputs = model(images)

            loss = criterion(
                outputs,
                labels
            )

            val_loss += loss.item()

            predictions = torch.argmax(
                outputs,
                dim=1
            )

            all_labels.extend(
                labels.cpu().numpy()
            )

            all_predictions.extend(
                predictions.cpu().numpy()
            )


    val_loss /= len(val_loader)


    # --------------------------------------------------------
    # METRICS
    # --------------------------------------------------------

    accuracy = np.mean(
        np.array(all_labels)
        ==
        np.array(all_predictions)
    )

    qwk = cohen_kappa_score(
        all_labels,
        all_predictions,
        weights="quadratic"
    )


    print("\nRESULTS")
    print("-" * 40)

    print(
        f"Train Loss : {train_loss:.4f}"
    )

    print(
        f"Val Loss   : {val_loss:.4f}"
    )

    print(
        f"Accuracy   : {accuracy:.4f}"
    )

    print(
        f"QWK        : {qwk:.4f}"
    )


    # --------------------------------------------------------
    # SAVE BEST MODEL
    # --------------------------------------------------------

    if qwk > best_qwk:

        best_qwk = qwk

        torch.save(
            {
                "model_state_dict":
                    model.state_dict(),

                "qwk":
                    qwk,

                "epoch":
                    epoch
            },
            "best_model.pth"
        )

        print(
            f"\nBEST MODEL SAVED!"
        )

        print(
            f"Best QWK: {best_qwk:.4f}"
        )


# ============================================================
# FINAL REPORT
# ============================================================

print("\n")
print("=" * 60)
print("TRAINING COMPLETE")
print("=" * 60)

print(
    f"Best QWK: {best_qwk:.4f}"
)

print("\nClassification Report:")

print(
    classification_report(
        all_labels,
        all_predictions,
        digits=4
    )
)