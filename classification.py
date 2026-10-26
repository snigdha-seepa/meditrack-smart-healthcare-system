
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.tree import DecisionTreeClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay
)

import matplotlib.pyplot as plt


# 1. Load the PostgreSQL-exported dataset
df = pd.read_csv("classification_dataset.csv")

print("=" * 55)
print("MEDiTRACK DWM - DECISION TREE CLASSIFICATION")
print("=" * 55)

print("\nDataset shape:", df.shape)

print("\nFirst five records:")
print(df.head())

print("\nTarget class distribution:")
print(df["target"].value_counts())


# 2. Select input features and target
numeric_features = ["age"]

categorical_features = [
    "gender",
    "blood_type",
    "medical_condition",
    "admission_type",
    "medication"
]

X = df[numeric_features + categorical_features]
y = df["target"]


# 3. Encode categorical features
preprocessor = ColumnTransformer(
    transformers=[
        ("numeric", "passthrough", numeric_features),
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            categorical_features
        )
    ]
)


# 4. Create the Decision Tree model
model = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        (
            "classifier",
            DecisionTreeClassifier(
                max_depth=6,
                random_state=42
            )
        )
    ]
)


# 5. Split data into training and testing sets
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("\nTraining records:", len(X_train))
print("Testing records:", len(X_test))


# 6. Train the model
model.fit(X_train, y_train)

print("\nModel training completed!")


# 7. Make predictions
y_pred = model.predict(X_test)


# 8. Evaluate performance
accuracy = accuracy_score(y_test, y_pred)

print("\nAccuracy:", round(accuracy * 100, 2), "%")

print("\nClassification Report:")
print(
    classification_report(
        y_test,
        y_pred,
        zero_division=0
    )
)

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, y_pred))


# 9. Display and save the confusion matrix
ConfusionMatrixDisplay.from_predictions(
    y_test,
    y_pred,
    xticks_rotation="vertical"
)

plt.title("MediTrack DWM - Decision Tree Classification")
plt.tight_layout()
plt.savefig("classification_confusion_matrix.png", dpi=150)

print("\nConfusion matrix saved as:")
print("classification_confusion_matrix.png")

plt.show()
