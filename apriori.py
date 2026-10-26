
import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules

df = pd.read_csv("classification_dataset.csv")

columns = [
    "gender",
    "blood_type",
    "medical_condition",
    "admission_type",
    "medication",
    "target"
]

data = df[columns].dropna().copy()

transactions = pd.get_dummies(
    data,
    columns=columns,
    dtype=bool
)

print("MEDiTrack DWM - APRIORI")
print("Records:", len(data))
print("Transaction items:", transactions.shape[1])

# Preserve the original frozenset itemsets for rule generation
frequent_itemsets = apriori(
    transactions,
    min_support=0.03,
    use_colnames=True,
    max_len=3
)

print("\nFrequent itemsets:", len(frequent_itemsets))

if frequent_itemsets.empty:
    print("No frequent itemsets found. Try a lower support threshold.")
else:
    frequent_itemsets.to_csv(
        "apriori_frequent_itemsets.csv",
        index=False
    )

    rules = association_rules(
        frequent_itemsets,
        metric="confidence",
        min_threshold=0.30
    )

    if rules.empty:
        print("No rules met the confidence threshold.")
    else:
        rules["antecedents"] = rules["antecedents"].apply(
            lambda x: ", ".join(sorted(x))
        )
        rules["consequents"] = rules["consequents"].apply(
            lambda x: ", ".join(sorted(x))
        )

        rules = rules.sort_values(
            ["lift", "confidence"],
            ascending=False
        )

        print("\nTop 15 association rules:")
        print(
            rules[
                ["antecedents", "consequents",
                 "support", "confidence", "lift"]
            ].head(15).to_string(index=False)
        )

        rules.to_csv("apriori_association_rules.csv", index=False)

    print("\nResults saved successfully.")
