
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import silhouette_score

# Load the same exported dataset
df = pd.read_csv("classification_dataset.csv")

numeric_features = ["age"]

categorical_features = [
    "gender",
    "blood_type",
    "medical_condition",
    "admission_type",
    "medication"
]

# Clustering is unsupervised: do not include the target column.
df = df.dropna(subset=numeric_features + categorical_features).copy()

preprocessor = ColumnTransformer([
    ("numeric", StandardScaler(), numeric_features),
    ("categorical", OneHotEncoder(handle_unknown="ignore"),
     categorical_features)
])

X = preprocessor.fit_transform(
    df[numeric_features + categorical_features]
)

print("MEDiTrack DWM - Clustering")
print("Records:", len(df))
print("Features after encoding:", X.shape[1])

# 1. K-Means on the full dataset
kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
df["kmeans_cluster"] = kmeans.fit_predict(X)

print("\nK-Means cluster sizes:")
print(df["kmeans_cluster"].value_counts().sort_index())

# Silhouette score on a reproducible sample to limit computation
sample_size = min(3000, len(df))
sample_indices = df.sample(
    n=sample_size, random_state=42
).index

sample_positions = df.index.get_indexer(sample_indices)
X_sample = X[sample_positions]

if hasattr(X_sample, "toarray"):
    X_sample = X_sample.toarray()

sample_labels = df.loc[sample_indices, "kmeans_cluster"].to_numpy()

print("\nK-Means silhouette score on sample:")
if len(set(sample_labels)) > 1:
    print(round(silhouette_score(X_sample, sample_labels), 4))
else:
    print("Not available: only one cluster found in the sample.")

# 2. Agglomerative clustering on a smaller sample
agg_size = min(2000, len(df))
agg_df = df.sample(n=agg_size, random_state=42)

agg_positions = df.index.get_indexer(agg_df.index)
X_agg = X[agg_positions]

if hasattr(X_agg, "toarray"):
    X_agg = X_agg.toarray()

agg_model = AgglomerativeClustering(n_clusters=3)
agg_labels = agg_model.fit_predict(X_agg)

print("\nAgglomerative cluster sizes:")
print(pd.Series(agg_labels).value_counts().sort_index())

if len(set(agg_labels)) > 1:
    print("\nAgglomerative silhouette score:")
    print(round(silhouette_score(X_agg, agg_labels), 4))

# Save the clustering results
df.to_csv("clustering_results.csv", index=False)

print("\nSaved results to clustering_results.csv")
