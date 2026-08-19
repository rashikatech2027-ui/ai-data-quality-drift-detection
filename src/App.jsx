import React, { useRef, useState } from "react";
import "./App.css";

function App() {
  const fileInputRef = useRef(null);

  const [page, setPage] = useState("dashboard");
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [referenceData, setReferenceData] = useState(null);
  const [referenceFile, setReferenceFile] = useState(null);

  // =========================================================
  // CSV PARSER
  // =========================================================

  const parseCSV = (text) => {
    const lines = text
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    if (lines.length === 0) {
      return [];
    }

    const parseLine = (line) => {
      const result = [];
      let current = "";
      let insideQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === "," && !insideQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }

      result.push(current.trim());

      return result;
    };

    const headers = parseLine(lines[0]).map((header) =>
      header.replace(/^"|"$/g, "").trim()
    );

    return lines.slice(1).map((line) => {
      const values = parseLine(line);
      const row = {};

      headers.forEach((header, index) => {
        row[header] = (values[index] ?? "")
          .replace(/^"|"$/g, "")
          .trim();
      });

      return row;
    });
  };

  // =========================================================
  // DATA QUALITY FUNCTIONS
  // =========================================================

  const isMissing = (value) => {
    if (value === null || value === undefined) {
      return true;
    }

    const valueString = String(value).trim().toLowerCase();

    return (
      valueString === "" ||
      valueString === "null" ||
      valueString === "na" ||
      valueString === "n/a" ||
      valueString === "nan"
    );
  };

  const isNumericColumn = (rows, column) => {
    const values = rows
      .map((row) => row[column])
      .filter((value) => !isMissing(value));

    if (values.length === 0) {
      return false;
    }

    return values.every((value) => {
      return !Number.isNaN(Number(value));
    });
  };

  const getOutlierCount = (rows, column) => {
    const values = rows
      .map((row) => Number(row[column]))
      .filter((value) => !Number.isNaN(value));

    if (values.length < 4) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);

    const q1Position = Math.floor((sorted.length - 1) * 0.25);
    const q3Position = Math.floor((sorted.length - 1) * 0.75);

    const q1 = sorted[q1Position];
    const q3 = sorted[q3Position];

    const iqr = q3 - q1;

    const lowerLimit = q1 - 1.5 * iqr;
    const upperLimit = q3 + 1.5 * iqr;

    return values.filter(
      (value) => value < lowerLimit || value > upperLimit
    ).length;
  };

  const analyzeDataset = (rows) => {
    if (!rows || rows.length === 0) {
      return null;
    }

    const columns = Object.keys(rows[0]);

    let missingValues = 0;
    let duplicateValues = 0;
    let outlierValues = 0;

    const columnAnalysis = columns.map((column) => {
      const missing = rows.filter((row) =>
        isMissing(row[column])
      ).length;

      let outliers = 0;

      if (isNumericColumn(rows, column)) {
        outliers = getOutlierCount(rows, column);
      }

      missingValues += missing;
      outlierValues += outliers;

      return {
        name: column,
        missing,
        outliers,
        status:
          missing > 0 || outliers > 0
            ? "Needs Attention"
            : "Healthy",
      };
    });

    const seenRows = new Set();

    rows.forEach((row) => {
      const key = JSON.stringify(row);

      if (seenRows.has(key)) {
        duplicateValues++;
      } else {
        seenRows.add(key);
      }
    });

    const totalIssues =
      missingValues +
      duplicateValues +
      outlierValues;

    const penalty =
      rows.length > 0
        ? Math.min(
            100,
            (totalIssues / rows.length) * 10
          )
        : 0;

    const qualityScore = Math.max(
      0,
      Number((100 - penalty).toFixed(1))
    );

    return {
      rows: rows.length,
      columns: columns.length,
      columnNames: columns,
      missingValues,
      duplicateValues,
      outlierValues,
      totalIssues,
      qualityScore,
      columnAnalysis,
      data: rows,
    };
  };

  // =========================================================
  // FILE UPLOAD
  // =========================================================

  const processFile = (
    selectedFile,
    isReference = false
  ) => {
    if (!selectedFile) {
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload a CSV file.");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const rows = parseCSV(text);

        if (rows.length === 0) {
          alert("The CSV file appears to be empty.");
          return;
        }

        if (isReference) {
          setReferenceFile(selectedFile);
          setReferenceData(rows);
          setPage("drift");
        } else {
          const result = analyzeDataset(rows);

          setFile(selectedFile);
          setAnalysis(result);
          setPage("dashboard");
        }
      } catch (error) {
        console.error(error);
        alert("CSV file could not be processed.");
      }
    };

    reader.onerror = () => {
      alert("Could not read the selected file.");
    };

    reader.readAsText(selectedFile);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (selectedFile) {
      processFile(selectedFile, false);
    }

    event.target.value = "";
  };

  const handleReferenceUpload = (event) => {
    const selectedFile = event.target.files?.[0];

    if (selectedFile) {
      processFile(selectedFile, true);
    }

    event.target.value = "";
  };

  // =========================================================
  // DATA DRIFT
  // =========================================================

  const calculateDrift = () => {
    if (!analysis || !referenceData) {
      return 0;
    }

    const currentRows = analysis.data;

    if (
      currentRows.length === 0 ||
      referenceData.length === 0
    ) {
      return 0;
    }

    const currentColumns = Object.keys(currentRows[0]);
    const referenceColumns = Object.keys(referenceData[0]);

    const commonColumns = currentColumns.filter(
      (column) => referenceColumns.includes(column)
    );

    if (commonColumns.length === 0) {
      return 0;
    }

    let changedColumns = 0;

    commonColumns.forEach((column) => {
      const currentValues = currentRows
        .map((row) => row[column])
        .filter((value) => !isMissing(value));

      const referenceValues = referenceData
        .map((row) => row[column])
        .filter((value) => !isMissing(value));

      if (
        currentValues.length === 0 ||
        referenceValues.length === 0
      ) {
        return;
      }

      if (
        isNumericColumn(currentRows, column) &&
        isNumericColumn(referenceData, column)
      ) {
        const currentMean =
          currentValues.reduce(
            (sum, value) => sum + Number(value),
            0
          ) / currentValues.length;

        const referenceMean =
          referenceValues.reduce(
            (sum, value) => sum + Number(value),
            0
          ) / referenceValues.length;

        const denominator =
          Math.abs(referenceMean) || 1;

        const difference =
          Math.abs(currentMean - referenceMean) /
          denominator;

        if (difference > 0.2) {
          changedColumns++;
        }
      } else {
        const currentUnique = new Set(currentValues);
        const referenceUnique = new Set(referenceValues);

        let different = 0;

        currentUnique.forEach((value) => {
          if (!referenceUnique.has(value)) {
            different++;
          }
        });

        if (different > 0) {
          changedColumns++;
        }
      }
    });

    return Number(
      (
        (changedColumns / commonColumns.length) *
        100
      ).toFixed(1)
    );
  };

  const driftScore = calculateDrift();

  // =========================================================
  // NAVIGATION
  // =========================================================

  const navigate = (targetPage) => {
    setPage(targetPage);
  };

  // =========================================================
  // INLINE CSS
  // =========================================================

  const styles = {
    app: {
      minHeight: "100vh",
      display: "flex",
      background: "#f4f7fb",
      color: "#14213d",
      fontFamily:
        "Inter, Segoe UI, Arial, sans-serif",
      overflow: "hidden",
    },

    sidebar: {
      width: "250px",
      background:
        "linear-gradient(180deg, #0b1629 0%, #101d35 100%)",
      color: "#fff",
      minHeight: "100vh",
      padding: "24px 18px",
      boxSizing: "border-box",
      position: "fixed",
      left: 0,
      top: 0,
      bottom: 0,
      zIndex: 20,
      boxShadow:
        "8px 0 30px rgba(15, 23, 42, 0.08)",
    },

    logoRow: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      marginBottom: "38px",
    },

    logo: {
      width: "46px",
      height: "46px",
      background:
        "linear-gradient(135deg, #2563eb, #60a5fa)",
      borderRadius: "12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: "20px",
      boxShadow:
        "0 8px 22px rgba(37, 99, 235, 0.35)",
      animation: "floatLogo 3s ease-in-out infinite",
    },

    logoTitle: {
      fontSize: "20px",
      fontWeight: 800,
    },

    logoSubtitle: {
      fontSize: "13px",
      color: "#9aa8c2",
      marginTop: "2px",
    },

    menuTitle: {
      color: "#75839d",
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "1px",
      marginBottom: "12px",
    },

    navButton: {
      width: "100%",
      border: "none",
      background: "transparent",
      color: "#dce5f5",
      padding: "13px 14px",
      borderRadius: "10px",
      textAlign: "left",
      cursor: "pointer",
      fontSize: "15px",
      marginBottom: "5px",
      transition:
        "all 0.25s ease",
    },

    activeNav: {
      background:
        "linear-gradient(90deg, #293f67, #263b5d)",
      color: "#fff",
      boxShadow:
        "0 8px 20px rgba(0, 0, 0, 0.15)",
      transform: "translateX(3px)",
    },

    main: {
      marginLeft: "250px",
      width: "calc(100% - 250px)",
      minHeight: "100vh",
    },

    topbar: {
      height: "86px",
      background: "rgba(255,255,255,0.94)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid #e5eaf2",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 34px",
      boxSizing: "border-box",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },

    breadcrumb: {
      color: "#8492aa",
      fontSize: "14px",
      marginBottom: "4px",
    },

    topTitle: {
      fontSize: "25px",
      fontWeight: 750,
      margin: 0,
    },

    userArea: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },

    userCircle: {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background:
        "linear-gradient(135deg, #2563eb, #3b82f6)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      boxShadow:
        "0 5px 16px rgba(37,99,235,0.25)",
    },

    content: {
      padding: "30px 34px 50px",
      animation:
        "pageEnter 0.45s ease",
    },

    pageIntro: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: "20px",
      marginBottom: "28px",
    },

    pageHeading: {
      fontSize: "30px",
      margin: "0 0 8px",
      letterSpacing: "-0.5px",
    },

    pageDescription: {
      color: "#66758f",
      fontSize: "16px",
      margin: 0,
      lineHeight: 1.5,
    },

    datasetName: {
      color: "#66758f",
      marginTop: "8px",
    },

    uploadButton: {
      background:
        "linear-gradient(135deg, #2563eb, #3b82f6)",
      color: "#fff",
      border: "none",
      borderRadius: "10px",
      padding: "13px 20px",
      cursor: "pointer",
      fontWeight: 650,
      fontSize: "14px",
      boxShadow:
        "0 8px 20px rgba(37,99,235,0.25)",
      transition:
        "all 0.25s ease",
    },

    cards: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(220px, 1fr))",
      gap: "18px",
      marginBottom: "22px",
    },

    card: {
      background: "#fff",
      border: "1px solid #e5eaf2",
      borderRadius: "14px",
      padding: "22px",
      boxSizing: "border-box",
      boxShadow:
        "0 4px 18px rgba(24, 45, 80, 0.05)",
      transition:
        "transform 0.3s ease, box-shadow 0.3s ease",
      animation:
        "cardEnter 0.55s ease both",
    },

    cardTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      color: "#65758f",
      fontSize: "14px",
      marginBottom: "18px",
    },

    cardValue: {
      fontSize: "32px",
      fontWeight: 750,
      margin: "0 0 8px",
    },

    muted: {
      color: "#8996aa",
      fontSize: "13px",
    },

    good: {
      color: "#00a65a",
      fontSize: "13px",
      fontWeight: 600,
    },

    warning: {
      color: "#ff6500",
      fontSize: "13px",
      fontWeight: 600,
    },

    danger: {
      color: "#ef4444",
      fontSize: "13px",
      fontWeight: 600,
    },

    panel: {
      background: "#fff",
      border: "1px solid #e5eaf2",
      borderRadius: "14px",
      padding: "24px",
      marginBottom: "22px",
      boxShadow:
        "0 4px 18px rgba(24, 45, 80, 0.05)",
      animation:
        "cardEnter 0.6s ease both",
    },

    panelHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "22px",
    },

    panelTitle: {
      margin: 0,
      fontSize: "20px",
    },

    panelText: {
      color: "#8a97ab",
      marginTop: "6px",
      fontSize: "13px",
    },

    statGrid: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(180px, 1fr))",
      gap: "18px",
    },

    statBox: {
      border: "1px solid #e6ebf3",
      borderRadius: "12px",
      padding: "20px",
      background: "#fff",
      transition:
        "all 0.25s ease",
    },

    statLabel: {
      color: "#65758f",
      fontSize: "14px",
      marginBottom: "12px",
    },

    statValue: {
      fontSize: "29px",
      fontWeight: 750,
    },

    table: {
      width: "100%",
      borderCollapse: "collapse",
    },

    th: {
      textAlign: "left",
      color: "#64748b",
      fontSize: "14px",
      padding: "14px",
      borderBottom: "1px solid #e6ebf2",
    },

    td: {
      padding: "15px 14px",
      borderBottom: "1px solid #edf0f5",
      fontSize: "14px",
    },

    badge: {
      display: "inline-block",
      padding: "7px 12px",
      borderRadius: "20px",
      background: "#eef2f7",
      color: "#526176",
      fontSize: "12px",
      fontWeight: 650,
    },

    healthyBadge: {
      display: "inline-block",
      padding: "6px 12px",
      borderRadius: "20px",
      background: "#e8f9ef",
      color: "#00894b",
      fontSize: "12px",
      fontWeight: 700,
    },

    attentionBadge: {
      display: "inline-block",
      padding: "6px 12px",
      borderRadius: "20px",
      background: "#fff2df",
      color: "#c95d00",
      fontSize: "12px",
      fontWeight: 700,
    },

    scoreBox: {
      background: "#fff",
      border: "1px solid #e5eaf2",
      borderRadius: "14px",
      padding: "20px 26px",
      minWidth: "145px",
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      boxShadow:
        "0 5px 18px rgba(24,45,80,0.05)",
    },

    progressOuter: {
      width: "100%",
      height: "8px",
      background: "#e8edf4",
      borderRadius: "10px",
      overflow: "hidden",
      marginTop: "12px",
    },

    progressInner: {
      height: "100%",
      background:
        "linear-gradient(90deg, #2563eb, #60a5fa)",
      borderRadius: "10px",
      transition:
        "width 1s ease",
    },

    driftBox: {
      border: "1px dashed #cbd5e1",
      borderRadius: "14px",
      padding: "55px 25px",
      textAlign: "center",
      background:
        "linear-gradient(135deg, #f9fbfd, #f3f7ff)",
    },

    reportGrid: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(150px, 1fr))",
      gap: "20px",
    },

    note: {
      marginTop: "25px",
      padding: "17px",
      background: "#eef5ff",
      color: "#2455a6",
      borderRadius: "10px",
      fontSize: "14px",
      lineHeight: 1.5,
    },
  };

  // =========================================================
  // DASHBOARD
  // =========================================================

  const renderDashboardPage = () => {
    const hasAnalysis = !!analysis;

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Welcome back 👋
            </h2>

            <p style={styles.pageDescription}>
              Monitor your datasets and detect quality
              issues in real time.
            </p>

            <p style={styles.datasetName}>
              Current dataset:{" "}
              <strong>
                {file
                  ? file.name
                  : "No dataset uploaded"}
              </strong>
            </p>
          </div>

          <button
            style={styles.uploadButton}
            onClick={openFilePicker}
          >
            + Upload Dataset
          </button>
        </div>

        <section style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Data Quality Score</span>
              <span>✓</span>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? `${analysis.qualityScore}%`
                : "—"}
            </h3>

            {hasAnalysis && (
              <div style={styles.progressOuter}>
                <div
                  style={{
                    ...styles.progressInner,
                    width: `${analysis.qualityScore}%`,
                  }}
                />
              </div>
            )}

            <p
              style={
                hasAnalysis
                  ? styles.good
                  : styles.muted
              }
            >
              {hasAnalysis
                ? "Calculated from uploaded dataset"
                : "Upload a dataset to begin"}
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Data Drift</span>
              <span>↗</span>
            </div>

            <h3 style={styles.cardValue}>
              {referenceData
                ? `${driftScore}%`
                : "0.0%"}
            </h3>

            <p style={styles.good}>
              {referenceData
                ? "Drift calculated"
                : "Awaiting reference dataset"}
            </p>

            {!referenceData && (
              <p style={styles.muted}>
                Upload reference data for comparison
              </p>
            )}
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Missing Values</span>
              <span>!</span>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? analysis.missingValues
                : 0}
            </h3>

            <p
              style={
                hasAnalysis &&
                analysis.missingValues > 0
                  ? styles.warning
                  : styles.good
              }
            >
              {hasAnalysis &&
              analysis.missingValues > 0
                ? "Needs attention"
                : "No missing values"}
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Total Issues</span>
              <span>!</span>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? analysis.totalIssues
                : 0}
            </h3>

            <p
              style={
                hasAnalysis &&
                analysis.totalIssues > 0
                  ? styles.danger
                  : styles.good
              }
            >
              {hasAnalysis &&
              analysis.totalIssues > 0
                ? "Issues detected"
                : "No issues detected"}
            </p>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Uploaded Dataset
              </h3>

              <p style={styles.panelText}>
                {hasAnalysis
                  ? "Dataset successfully processed."
                  : "No dataset has been uploaded yet."}
              </p>
            </div>

            <span style={styles.badge}>
              CSV Processed
            </span>
          </div>

          <div style={styles.statGrid}>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>
                Total Rows
              </div>

              <div style={styles.statValue}>
                {hasAnalysis
                  ? analysis.rows
                  : 0}
              </div>
            </div>

            <div style={styles.statBox}>
              <div style={styles.statLabel}>
                Total Columns
              </div>

              <div style={styles.statValue}>
                {hasAnalysis
                  ? analysis.columns
                  : 0}
              </div>
            </div>

            <div style={styles.statBox}>
              <div style={styles.statLabel}>
                Duplicate Rows
              </div>

              <div style={styles.statValue}>
                {hasAnalysis
                  ? analysis.duplicateValues
                  : 0}
              </div>
            </div>

            <div style={styles.statBox}>
              <div style={styles.statLabel}>
                Outliers
              </div>

              <div style={styles.statValue}>
                {hasAnalysis
                  ? analysis.outlierValues
                  : 0}
              </div>
            </div>
          </div>
        </section>

        {hasAnalysis && (
          <section style={styles.cards}>
            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>
                Data Quality Trend
              </h3>

              <p style={styles.panelText}>
                Current dataset quality score.
              </p>

              <div
                style={{
                  textAlign: "center",
                  marginTop: "35px",
                }}
              >
                <div
                  style={{
                    fontSize: "52px",
                    fontWeight: 800,
                  }}
                >
                  {analysis.qualityScore}%
                </div>

                <div style={styles.muted}>
                  Overall data quality score
                </div>

                <div style={styles.progressOuter}>
                  <div
                    style={{
                      ...styles.progressInner,
                      width: `${analysis.qualityScore}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={styles.panel}>
              <h3 style={styles.panelTitle}>
                Data Issues
              </h3>

              <p style={styles.panelText}>
                Issues detected in latest dataset.
              </p>

              <div style={{ marginTop: "30px" }}>
                <IssueBar
                  label="Missing Values"
                  value={analysis.missingValues}
                  max={Math.max(
                    analysis.totalIssues,
                    1
                  )}
                />

                <IssueBar
                  label="Duplicates"
                  value={analysis.duplicateValues}
                  max={Math.max(
                    analysis.totalIssues,
                    1
                  )}
                />

                <IssueBar
                  label="Outliers"
                  value={analysis.outlierValues}
                  max={Math.max(
                    analysis.totalIssues,
                    1
                  )}
                />
              </div>
            </div>
          </section>
        )}
      </>
    );
  };

  // =========================================================
  // UPLOAD PAGE
  // =========================================================

  const renderUploadPage = () => {
    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Upload Dataset
            </h2>

            <p style={styles.pageDescription}>
              Upload a CSV dataset to start automatic
              data quality analysis.
            </p>
          </div>
        </div>

        <section style={styles.panel}>
          <div style={styles.driftBox}>
            <div
              style={{
                fontSize: "45px",
                marginBottom: "15px",
                animation:
                  "floatIcon 2s ease-in-out infinite",
              }}
            >
              ↑
            </div>

            <h3 style={{ fontSize: "22px" }}>
              Upload your CSV dataset
            </h3>

            <p style={styles.panelText}>
              Supported format: CSV
            </p>

            <button
              style={{
                ...styles.uploadButton,
                marginTop: "15px",
              }}
              onClick={openFilePicker}
            >
              + Choose CSV File
            </button>

            {file && (
              <p style={{ marginTop: "20px" }}>
                Current file:{" "}
                <strong>{file.name}</strong>
              </p>
            )}
          </div>
        </section>
      </>
    );
  };

  // =========================================================
  // QUALITY PAGE
  // =========================================================

  const renderQualityPage = () => {
    if (!analysis) {
      return (
        <section style={styles.panel}>
          <div style={styles.driftBox}>
            <div style={{ fontSize: "40px" }}>
              📊
            </div>

            <h2>No Dataset Analyzed Yet</h2>

            <p style={styles.panelText}>
              Upload a CSV dataset to see detailed
              data quality analysis.
            </p>

            <button
              style={{
                ...styles.uploadButton,
                marginTop: "15px",
              }}
              onClick={openFilePicker}
            >
              + Upload Dataset
            </button>
          </div>
        </section>
      );
    }

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Data Quality Analysis
            </h2>

            <p style={styles.pageDescription}>
              Detailed quality assessment of your
              uploaded dataset.
            </p>

            <p style={styles.datasetName}>
              Dataset:{" "}
              <strong>{file?.name}</strong>
            </p>
          </div>

          <div style={styles.scoreBox}>
            <span>Overall Quality</span>

            <strong style={{ fontSize: "25px" }}>
              {analysis.qualityScore}%
            </strong>

            <span
              style={
                analysis.qualityScore >= 90
                  ? styles.good
                  : analysis.qualityScore >= 75
                  ? styles.warning
                  : styles.danger
              }
            >
              {analysis.qualityScore >= 90
                ? "Excellent"
                : analysis.qualityScore >= 75
                ? "Good"
                : "Needs Attention"}
            </span>
          </div>
        </div>

        <section style={styles.cards}>
          <QualityCard
            title="Missing Values"
            value={analysis.missingValues}
            message={
              analysis.missingValues > 0
                ? "Needs attention"
                : "No missing values"
            }
          />

          <QualityCard
            title="Duplicate Rows"
            value={analysis.duplicateValues}
            message={
              analysis.duplicateValues > 0
                ? "Duplicates detected"
                : "No duplicates"
            }
          />

          <QualityCard
            title="Outliers"
            value={analysis.outlierValues}
            message={
              analysis.outlierValues > 0
                ? "Outliers detected"
                : "No outliers"
            }
          />

          <QualityCard
            title="Total Issues"
            value={analysis.totalIssues}
            message={
              analysis.totalIssues > 0
                ? "Issues detected"
                : "No issues detected"
            }
          />
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Column-wise Quality Analysis
              </h3>

              <p style={styles.panelText}>
                Quality issues detected for each
                dataset column.
              </p>
            </div>

            <span style={styles.badge}>
              {analysis.columns} Columns
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>
                    Column
                  </th>

                  <th style={styles.th}>
                    Missing
                  </th>

                  <th style={styles.th}>
                    Outliers
                  </th>

                  <th style={styles.th}>
                    Status
                  </th>
                </tr>
              </thead>

              <tbody>
                {analysis.columnAnalysis.map(
                  (column) => (
                    <tr key={column.name}>
                      <td
                        style={{
                          ...styles.td,
                          fontWeight: 650,
                        }}
                      >
                        {column.name}
                      </td>

                      <td style={styles.td}>
                        {column.missing}
                      </td>

                      <td style={styles.td}>
                        {column.outliers}
                      </td>

                      <td style={styles.td}>
                        {column.status ===
                        "Healthy" ? (
                          <span
                            style={
                              styles.healthyBadge
                            }
                          >
                            Healthy
                          </span>
                        ) : (
                          <span
                            style={
                              styles.attentionBadge
                            }
                          >
                            Needs Attention
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={styles.panel}>
          <h3 style={styles.panelTitle}>
            Quality Assessment
          </h3>

          <p style={styles.panelText}>
            Automated checks performed on the
            uploaded dataset.
          </p>

          <div
            style={{
              ...styles.cards,
              marginTop: "20px",
            }}
          >
            <AssessmentCard
              number="01"
              title="Completeness Check"
              text="Scans all cells for missing, null and empty values."
            />

            <AssessmentCard
              number="02"
              title="Duplicate Detection"
              text="Identifies repeated complete records in the dataset."
            />

            <AssessmentCard
              number="03"
              title="Outlier Detection"
              text="Uses the IQR statistical method to identify extreme numeric values."
            />

            <AssessmentCard
              number="04"
              title="Quality Scoring"
              text="Generates an overall score based on detected data quality issues."
            />
          </div>
        </section>
      </>
    );
  };

  // =========================================================
  // DRIFT PAGE
  // =========================================================

  const renderDriftPage = () => {
    const comparedColumns =
      referenceData && analysis
        ? analysis.columnNames.filter((column) =>
            Object.keys(referenceData[0] || {}).includes(
              column
            )
          ).length
        : 0;

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Data Drift Detection
            </h2>

            <p style={styles.pageDescription}>
              Compare a current dataset against a
              reference dataset to identify
              distribution changes.
            </p>
          </div>

          <div style={styles.scoreBox}>
            <strong style={{ fontSize: "23px" }}>
              {referenceData
                ? `${driftScore}%`
                : "0.0%"}
            </strong>

            <span>Current Drift</span>
          </div>
        </div>

        <section style={styles.cards}>
          <QualityCard
            title="Drift Score"
            value={
              referenceData
                ? `${driftScore}%`
                : "0.0%"
            }
            message={
              referenceData
                ? "Comparison complete"
                : "Awaiting reference"
            }
          />

          <QualityCard
            title="Reference Dataset"
            value={
              referenceFile
                ? referenceFile.name
                : "—"
            }
            message={
              referenceFile
                ? "Uploaded"
                : "Not uploaded"
            }
          />

          <QualityCard
            title="Columns Compared"
            value={comparedColumns}
            message="Comparison columns"
          />

          <QualityCard
            title="Drift Status"
            value={
              referenceData
                ? driftScore > 20
                  ? "Attention"
                  : "Healthy"
                : "Pending"
            }
            message={
              referenceData
                ? driftScore > 20
                  ? "Significant drift"
                  : "Low drift detected"
                : "Ready for comparison"
            }
          />
        </section>

        <section style={styles.panel}>
          <div style={styles.driftBox}>
            <div
              style={{
                fontSize: "40px",
                marginBottom: "15px",
                animation:
                  "driftMove 2s ease-in-out infinite",
              }}
            >
              ↔
            </div>

            <h3 style={{ fontSize: "22px" }}>
              {referenceData
                ? "Reference dataset uploaded"
                : "Reference Dataset Required"}
            </h3>

            <p style={styles.panelText}>
              {referenceData
                ? `Comparing ${
                    file?.name || "current dataset"
                  } against ${
                    referenceFile?.name ||
                    "reference dataset"
                  }.`
                : "Upload a reference CSV to compare distributions and detect changes in numeric and categorical columns."}
            </p>

            <button
              style={{
                ...styles.uploadButton,
                marginTop: "15px",
              }}
              onClick={() =>
                document
                  .getElementById(
                    "reference-file-input"
                  )
                  ?.click()
              }
            >
              + Upload Reference Dataset
            </button>
          </div>
        </section>
      </>
    );
  };

  // =========================================================
  // REPORTS PAGE
  // =========================================================

  const renderReportsPage = () => {
    const hasAnalysis = !!analysis;

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Data Quality Reports
            </h2>

            <p style={styles.pageDescription}>
              Generate a presentation-ready summary
              of your dataset quality analysis.
            </p>

            {file && (
              <p style={styles.datasetName}>
                Current dataset:{" "}
                <strong>{file.name}</strong>
              </p>
            )}
          </div>

          <div style={styles.scoreBox}>
            <span>Overall Quality</span>

            <strong style={{ fontSize: "25px" }}>
              {hasAnalysis
                ? `${analysis.qualityScore}%`
                : "—"}
            </strong>

            <span
              style={
                hasAnalysis
                  ? analysis.qualityScore >= 90
                    ? styles.good
                    : analysis.qualityScore >= 75
                    ? styles.warning
                    : styles.danger
                  : styles.muted
              }
            >
              {hasAnalysis
                ? analysis.qualityScore >= 90
                  ? "Excellent"
                  : analysis.qualityScore >= 75
                  ? "Good"
                  : "Needs Attention"
                : "No analysis yet"}
            </span>
          </div>
        </div>

        <section style={styles.cards}>
          <QualityCard
            title="Latest Quality Score"
            value={
              hasAnalysis
                ? `${analysis.qualityScore}%`
                : "—"
            }
            message={
              hasAnalysis
                ? "Analysis available"
                : "Upload a dataset"
            }
          />

          <QualityCard
            title="Total Issues"
            value={
              hasAnalysis
                ? analysis.totalIssues
                : "—"
            }
            message={
              hasAnalysis &&
              analysis.totalIssues > 0
                ? "Review recommended"
                : "No issues detected"
            }
          />

          <QualityCard
            title="Dataset Rows"
            value={
              hasAnalysis
                ? analysis.rows
                : "—"
            }
            message="Processed records"
          />

          <QualityCard
            title="Dataset Columns"
            value={
              hasAnalysis
                ? analysis.columns
                : "—"
            }
            message="Detected fields"
          />
        </section>

        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Report Summary
              </h3>

              <p style={styles.panelText}>
                Current analysis snapshot.
              </p>
            </div>

            <span style={styles.badge}>
              Phase 1
            </span>
          </div>

          <div style={styles.reportGrid}>
            <ReportItem
              label="Dataset"
              value={
                file
                  ? file.name
                  : "No dataset uploaded"
              }
            />

            <ReportItem
              label="Quality Score"
              value={
                hasAnalysis
                  ? `${analysis.qualityScore}%`
                  : "—"
              }
            />

            <ReportItem
              label="Missing Values"
              value={
                hasAnalysis
                  ? analysis.missingValues
                  : "—"
              }
            />

            <ReportItem
              label="Duplicates"
              value={
                hasAnalysis
                  ? analysis.duplicateValues
                  : "—"
              }
            />

            <ReportItem
              label="Outliers"
              value={
                hasAnalysis
                  ? analysis.outlierValues
                  : "—"
              }
            />

            <ReportItem
              label="Total Issues"
              value={
                hasAnalysis
                  ? analysis.totalIssues
                  : "—"
              }
            />
          </div>

          <div style={styles.note}>
            {hasAnalysis ? (
              <>
                <strong>Report ready:</strong>{" "}
                Your dataset quality analysis has been
                completed. Review the detected issues
                before presentation.
              </>
            ) : (
              <>
                <strong>Next step:</strong>{" "}
                Upload a CSV dataset to generate the
                quality report.
              </>
            )}
          </div>
        </section>
      </>
    );
  };

  // =========================================================
  // PAGE TITLE
  // =========================================================

  const getPageTitle = () => {
    if (page === "quality") {
      return "Data Quality Analysis";
    }

    if (page === "drift") {
      return "Data Drift Detection";
    }

    if (page === "reports") {
      return "Data Quality Reports";
    }

    if (page === "upload") {
      return "Upload Dataset";
    }

    return "Data Quality Overview";
  };

  // =========================================================
  // PAGE RENDER
  // =========================================================

  const renderPage = () => {
    if (page === "quality") {
      return renderQualityPage();
    }

    if (page === "drift") {
      return renderDriftPage();
    }

    if (page === "reports") {
      return renderReportsPage();
    }

    if (page === "upload") {
      return renderUploadPage();
    }

    return renderDashboardPage();
  };

  // =========================================================
  // MAIN UI
  // =========================================================

  return (
    <>
      <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f4f7fb;
        }

        button:hover {
          transform: translateY(-2px);
          filter: brightness(1.04);
        }

        button:active {
          transform: translateY(0);
        }

        @keyframes pageEnter {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes cardEnter {
          from {
            opacity: 0;
            transform: translateY(18px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes floatLogo {
          0%, 100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(-5px);
          }
        }

        @keyframes floatIcon {
          0%, 100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes driftMove {
          0%, 100% {
            transform: translateX(-8px);
          }

          50% {
            transform: translateX(8px);
          }
        }

        ::-webkit-scrollbar {
          width: 8px;
        }

        ::-webkit-scrollbar-track {
          background: #eef2f7;
        }

        ::-webkit-scrollbar-thumb {
          background: #b9c4d4;
          border-radius: 20px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: #8fa0b8;
        }
      `}</style>

      <div style={styles.app}>
        {/* SIDEBAR */}

        <aside style={styles.sidebar}>
          <div style={styles.logoRow}>
            <div style={styles.logo}>
              DQ
            </div>

            <div>
              <div style={styles.logoTitle}>
                DataGuard
              </div>

              <div style={styles.logoSubtitle}>
                AI Data Platform
              </div>
            </div>
          </div>

          <div style={styles.menuTitle}>
            MAIN MENU
          </div>

          <button
            style={{
              ...styles.navButton,
              ...(page === "dashboard"
                ? styles.activeNav
                : {}),
            }}
            onClick={() =>
              navigate("dashboard")
            }
          >
            ⌂ &nbsp; Dashboard
          </button>

          <button
            style={{
              ...styles.navButton,
              ...(page === "upload"
                ? styles.activeNav
                : {}),
            }}
            onClick={() =>
              navigate("upload")
            }
          >
            ↑ &nbsp; Upload Dataset
          </button>

          <button
            style={{
              ...styles.navButton,
              ...(page === "quality"
                ? styles.activeNav
                : {}),
            }}
            onClick={() =>
              navigate("quality")
            }
          >
            ◇ &nbsp; Data Quality
          </button>

          <button
            style={{
              ...styles.navButton,
              ...(page === "drift"
                ? styles.activeNav
                : {}),
            }}
            onClick={() =>
              navigate("drift")
            }
          >
            ↗ &nbsp; Data Drift
          </button>

          <button
            style={{
              ...styles.navButton,
              ...(page === "reports"
                ? styles.activeNav
                : {}),
            }}
            onClick={() =>
              navigate("reports")
            }
          >
            ▤ &nbsp; Reports
          </button>

          <div
            style={{
              ...styles.menuTitle,
              marginTop: "35px",
            }}
          >
            SYSTEM
          </div>

          <button
            style={styles.navButton}
            onClick={() =>
              alert(
                "Settings will be available in a future phase."
              )
            }
          >
            ⚙ &nbsp; Settings
          </button>
        </aside>

        {/* MAIN */}

        <main style={styles.main}>
          <header style={styles.topbar}>
            <div>
              <div style={styles.breadcrumb}>
                Dashboard / {getPageTitle()}
              </div>

              <h1 style={styles.topTitle}>
                {getPageTitle()}
              </h1>
            </div>

            <div style={styles.userArea}>
              <div style={styles.userCircle}>
                U
              </div>

              <div>
                <strong>User</strong>

                <div
                  style={{
                    color: "#8996aa",
                    fontSize: "13px",
                  }}
                >
                  Data Engineer
                </div>
              </div>
            </div>
          </header>

          <div style={styles.content}>
            {renderPage()}
          </div>
        </main>

        {/* CURRENT DATASET INPUT */}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        {/* REFERENCE DATASET INPUT */}

        <input
          id="reference-file-input"
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={handleReferenceUpload}
        />
      </div>
    </>
  );
}

// =========================================================
// QUALITY CARD
// =========================================================

function QualityCard({
  title,
  value,
  message,
}) {
  const isLong =
    typeof value === "string" &&
    value.length > 15;

  const isWarning =
    message &&
    (
      message.includes("Attention") ||
      message.includes("Review") ||
      message.includes("detected")
    );

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5eaf2",
        borderRadius: "14px",
        padding: "22px",
        boxShadow:
          "0 4px 18px rgba(24,45,80,0.05)",
        transition:
          "transform 0.3s ease, box-shadow 0.3s ease",
        animation:
          "cardEnter 0.55s ease both",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform =
          "translateY(-6px)";
        event.currentTarget.style.boxShadow =
          "0 15px 35px rgba(24,45,80,0.12)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform =
          "translateY(0)";
        event.currentTarget.style.boxShadow =
          "0 4px 18px rgba(24,45,80,0.05)";
      }}
    >
      <div
        style={{
          color: "#65758f",
          fontSize: "14px",
          marginBottom: "18px",
        }}
      >
        {title}
      </div>

      <h3
        style={{
          fontSize: isLong
            ? "17px"
            : "32px",
          fontWeight: 750,
          margin: "0 0 8px",
          wordBreak: "break-word",
        }}
      >
        {value}
      </h3>

      <p
        style={{
          color: isWarning
            ? "#ff6500"
            : "#00a65a",
          fontSize: "13px",
          fontWeight: 600,
          margin: 0,
        }}
      >
        {message}
      </p>
    </div>
  );
}

// =========================================================
// ASSESSMENT CARD
// =========================================================

function AssessmentCard({
  number,
  title,
  text,
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5eaf2",
        borderRadius: "12px",
        padding: "22px",
        transition:
          "all 0.3s ease",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform =
          "translateY(-5px)";
        event.currentTarget.style.boxShadow =
          "0 12px 28px rgba(24,45,80,0.1)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform =
          "translateY(0)";
        event.currentTarget.style.boxShadow =
          "none";
      }}
    >
      <div
        style={{
          color: "#2563eb",
          fontWeight: 800,
          marginBottom: "12px",
        }}
      >
        {number}
      </div>

      <h3
        style={{
          margin: "0 0 12px",
          fontSize: "17px",
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin: 0,
          color: "#65758f",
          fontSize: "14px",
          lineHeight: 1.5,
        }}
      >
        {text}
      </p>
    </div>
  );
}

// =========================================================
// REPORT ITEM
// =========================================================

function ReportItem({
  label,
  value,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <span
        style={{
          color: "#7c8ba2",
          fontSize: "13px",
        }}
      >
        {label}
      </span>

      <strong
        style={{
          fontSize: "15px",
          wordBreak: "break-word",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

// =========================================================
// ISSUE BAR
// =========================================================

function IssueBar({
  label,
  value,
  max,
}) {
  const percentage =
    max > 0
      ? Math.min(100, (value / max) * 100)
      : 0;

  return (
    <div style={{ marginBottom: "22px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "8px",
          fontSize: "14px",
        }}
      >
        <span>{label}</span>

        <strong>{value}</strong>
      </div>

      <div
        style={{
          height: "9px",
          background: "#e9eef5",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background:
              "linear-gradient(90deg, #2563eb, #60a5fa)",
            borderRadius: "10px",
            transition:
              "width 1s ease",
          }}
        />
      </div>
    </div>
  );
}

export default App;