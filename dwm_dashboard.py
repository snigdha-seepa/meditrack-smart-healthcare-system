
import streamlit as st
import pandas as pd
import plotly.express as px

st.set_page_config(
    page_title="MediTrack | DWM Analytics",
    page_icon="🏥",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ---------- CUSTOM STYLING ----------
st.markdown("""
<style>
    .stApp {
        background-color: #0b1120;
        color: #f1f5f9;
    }

    [data-testid="stHeader"] {
        background-color: #0b1120;
    }

    [data-testid="stSidebar"] {
        background-color: #111c30;
    }

    [data-testid="stSidebar"] * {
        color: #f1f5f9 !important;
    }

    h1, h2, h3, h4, p, label, li {
        color: #f1f5f9;
    }

    [data-testid="stMetric"] {
        background-color: #17263b;
        border: 1px solid #30445e;
        border-radius: 14px;
        padding: 20px 18px;
        min-height: 125px;
    }

    [data-testid="stMetricLabel"],
    [data-testid="stMetricLabel"] p {
        color: #cbd5e1 !important;
        font-size: 14px !important;
    }

    [data-testid="stMetricValue"],
    [data-testid="stMetricValue"] div {
        color: #ffffff !important;
        font-size: 30px !important;
        font-weight: 700 !important;
    }

    [data-testid="stMetricDelta"] {
        color: #5eead4 !important;
    }

    div[data-testid="stAlert"] {
        border-radius: 10px;
    }

    div[data-testid="stTabs"] button {
        color: #e2e8f0 !important;
    }

    div[data-testid="stDataFrame"] {
        border: 1px solid #30445e;
        border-radius: 10px;
    }

    .hero {
        background: linear-gradient(110deg, #142b46, #123d45);
        padding: 24px;
        border-radius: 16px;
        border: 1px solid #31516a;
        margin-bottom: 20px;
    }

    .hero h1 {
        margin: 0;
        color: #ffffff;
    }

    .hero p {
        margin: 8px 0 0 0;
        color: #cbd5e1;
    }

    .section-note {
        color: #94a3b8;
        font-size: 13px;
    }
</style>
""", unsafe_allow_html=True)


# ---------- SAMPLE DATA ----------
# Replace these values with actual project data when available.
df = pd.DataFrame({
    "Department": [
        "Cardiology", "General", "Orthopedics",
        "Pediatrics", "Neurology", "Cardiology",
        "General", "Orthopedics", "Pediatrics", "Neurology"
    ],
    "Appointments": [120, 180, 95, 110, 75, 100, 150, 80, 90, 65],
    "Avg_Wait_Minutes": [25, 35, 30, 20, 28, 22, 32, 27, 18, 24],
    "Completed": [108, 160, 85, 101, 68, 91, 136, 72, 82, 59],
    "No_Shows": [12, 20, 10, 9, 7, 9, 14, 8, 8, 6],
    "Insurance": [
        "Insured", "Uninsured", "Insured", "Insured",
        "Uninsured", "Insured", "Insured", "Uninsured",
        "Insured", "Insured"
    ],
    "Month": [
        "Jan", "Jan", "Feb", "Feb", "Mar",
        "Mar", "Apr", "Apr", "May", "May"
    ]
})


# ---------- HEADER ----------
st.markdown("""
<div class="hero">
    <h1>🏥 MediTrack Analytics</h1>
    <p>Hospital Appointment Management | Data Warehousing & Data Mining</p>
</div>
""", unsafe_allow_html=True)

st.info(
    "Academic demonstration: all figures are illustrative sample data, "
    "not live patient records."
)


# ---------- SIDEBAR ----------
st.sidebar.title("📊 Dashboard Controls")
st.sidebar.caption("Filter the analytics below")

all_departments = sorted(df["Department"].unique())

departments = st.sidebar.multiselect(
    "Department",
    options=all_departments,
    default=all_departments
)

insurance_filter = st.sidebar.selectbox(
    "Insurance status",
    ["All", "Insured", "Uninsured"]
)

filtered = df[df["Department"].isin(departments)].copy()

if insurance_filter != "All":
    filtered = filtered[
        filtered["Insurance"] == insurance_filter
    ]

# ---------- CALCULATE METRICS ----------
total = int(filtered["Appointments"].sum())
completed = int(filtered["Completed"].sum())
no_shows = int(filtered["No_Shows"].sum())

avg_wait = (
    round(
        (
            filtered["Appointments"]
            * filtered["Avg_Wait_Minutes"]
        ).sum() / total
    )
    if total > 0 else 0
)

no_show_rate = (
    round(no_shows / total * 100, 1)
    if total > 0 else 0
)


# ---------- KPI CARDS ----------
st.subheader("Hospital Overview")

c1, c2, c3, c4 = st.columns(4)

c1.metric("Total Appointments", f"{total:,}")
c2.metric("Completed Appointments", f"{completed:,}")
c3.metric("Average Waiting Time", f"{avg_wait} min")
c4.metric("No-show Rate", f"{no_show_rate}%")

st.write("")

overview_tab, dwm_tab, insurance_tab, data_tab = st.tabs([
    "📈 Overview",
    "🧠 DWM Analysis",
    "🛡️ Insurance",
    "🗃️ Data Explorer"
])


# ---------- OVERVIEW TAB ----------
with overview_tab:
    left, right = st.columns(2)

    with left:
        st.subheader("Appointments by Department")

        department_data = (
            filtered.groupby("Department", as_index=False)
            ["Appointments"].sum()
        )

        fig = px.bar(
            department_data,
            x="Department",
            y="Appointments",
            color="Department",
            template="plotly_dark",
            title="Department-wise Appointments"
        )
        fig.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            showlegend=False
        )
        st.plotly_chart(fig, use_container_width=True)

    with right:
        st.subheader("Appointment Status")

        other = max(total - completed - no_shows, 0)

        status_data = pd.DataFrame({
            "Status": ["Completed", "No-show", "Other"],
            "Count": [completed, no_shows, other]
        })

        fig = px.pie(
            status_data,
            names="Status",
            values="Count",
            hole=0.55,
            template="plotly_dark",
            title="Appointment Status Distribution"
        )
        fig.update_layout(
            paper_bgcolor="rgba(0,0,0,0)"
        )
        st.plotly_chart(fig, use_container_width=True)

    st.subheader("Waiting Time by Department")

    wait_data = (
        filtered.groupby("Department", as_index=False)
        .agg(
            Avg_Wait=("Avg_Wait_Minutes", "mean")
        )
    )

    fig = px.bar(
        wait_data,
        x="Department",
        y="Avg_Wait",
        color="Department",
        template="plotly_dark",
        labels={"Avg_Wait": "Average waiting time (minutes)"}
    )
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        showlegend=False
    )
    st.plotly_chart(fig, use_container_width=True)


# ---------- DWM ANALYSIS TAB ----------
with dwm_tab:
    st.subheader("Data Warehousing & Data Mining")

    st.markdown("### ETL Pipeline")

    p1, p2, p3, p4 = st.columns(4)

    p1.info("**1. Extract**\n\nCollect operational data")
    p2.info("**2. Transform**\n\nClean and prepare data")
    p3.info("**3. Load**\n\nStore prepared data")
    p4.info("**4. Analyze**\n\nGenerate insights")

    st.markdown("### Proposed Star Schema")

    st.code("""
                  dim_patient
                       |
    dim_doctor -- fact_appointment -- dim_department
                       |
              dim_date / dim_time
                       |
             dim_appointment_type
    """, language="text")

    st.caption(
        "Conceptual schema. Confirm which tables have actually "
        "been implemented in your database."
    )

    st.markdown("### OLAP: Department Comparison")

    olap = (
        filtered.groupby("Department", as_index=False)
        .agg(
            Appointments=("Appointments", "sum"),
            Avg_Wait=("Avg_Wait_Minutes", "mean"),
            Completed=("Completed", "sum")
        )
    )

    st.dataframe(olap, use_container_width=True)

    st.markdown("### Apriori Association Rules")

    rules = pd.DataFrame({
        "Antecedent": [
            "Condition A",
            "Appointment Type B",
            "Department C"
        ],
        "Consequent": [
            "Outcome B",
            "Outcome C",
            "Outcome A"
        ],
        "Support": [0.12, 0.08, 0.05],
        "Confidence": [0.65, 0.72, 0.40],
        "Lift": [1.30, 1.15, 0.95]
    })

    st.dataframe(rules, use_container_width=True)

    st.caption(
        "Illustrative rules only; replace them with your actual "
        "Apriori experiment output before presenting them as results."
    )

    st.markdown("### Mining Techniques")

    m1, m2 = st.columns(2)

    with m1:
        st.markdown("**Classification**")
        st.write("Predicts categories, such as likely appointment attendance.")

        st.markdown("**Regression**")
        st.write("Estimates numerical values, such as waiting time.")

    with m2:
        st.markdown("**Clustering**")
        st.write("Groups records with similar characteristics.")

        st.markdown("**Apriori**")
        st.write("Finds frequent associations among data items.")


# ---------- INSURANCE TAB ----------
with insurance_tab:
    st.subheader("Insurance Overview")

    insurance_data = (
        filtered.groupby("Insurance", as_index=False)
        ["Appointments"].sum()
    )

    fig = px.pie(
        insurance_data,
        names="Insurance",
        values="Appointments",
        hole=0.5,
        template="plotly_dark",
        title="Appointments by Insurance Status"
    )

    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)"
    )

    st.plotly_chart(fig, use_container_width=True)

    st.warning(
        "Insurance information is for administrative analytics only. "
        "Emergency triage priority must be based on clinical urgency."
    )

    st.caption(
        "Insurance-company analysis requires an insurer field in your "
        "actual dataset; this sample does not contain company names."
    )


# ---------- DATA EXPLORER TAB ----------
with data_tab:
    st.subheader("Data Explorer")

    st.write(
        f"Showing {len(filtered)} sample records for the selected filters."
    )

    st.dataframe(filtered, use_container_width=True)

    st.download_button(
        label="⬇️ Download Filtered CSV",
        data=filtered.to_csv(index=False).encode("utf-8"),
        file_name="meditrack_demo_data.csv",
        mime="text/csv"
    )


# ---------- FOOTER ----------
st.divider()

st.caption(
    "MediTrack | Academic Demonstration | "
    "DWM Analytics Dashboard"
)
