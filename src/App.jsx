import React, { useRef, useState } from "react";

function App() {
  const fileInputRef = useRef(null);
  const referenceInputRef = useRef(null);
  const currentInputRef = useRef(null);

  const [page, setPage] = useState("dashboard");

  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const [referenceData, setReferenceData] = useState(null);
  const [referenceFile, setReferenceFile] = useState(null);

  const [driftResult, setDriftResult] = useState(null);

  // =========================================================
  // CSV PARSER
  // =========================================================

  const parseCSV = (text) => {
    const lines = text
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    if (lines.length === 0) return [];

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
  // DATA QUALITY
  // =========================================================

  const isMissing = (value) => {
    if (value === null || value === undefined) return true;

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

    if (values.length === 0) return false;

    return values.every((value) => !Number.isNaN(Number(value)));
  };

  const getOutlierCount = (rows, column) => {
    const values = rows
      .map((row) => Number(row[column]))
      .filter((value) => !Number.isNaN(value));

    if (values.length < 4) return 0;

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
    if (!rows || rows.length === 0) return null;

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
  // FILE PROCESSING
  // =========================================================

  const processFile = (
    selectedFile,
    isReference = false
  ) => {
    if (!selectedFile) return;

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

  const handleCurrentUpload = (event) => {
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
  // DRIFT CALCULATION
  // =========================================================

  const calculateDrift = () => {
    if (!analysis || !referenceData) {
      return null;
    }

    const currentRows = analysis.data;

    if (
      currentRows.length === 0 ||
      referenceData.length === 0
    ) {
      return null;
    }

    const currentColumns = Object.keys(currentRows[0]);
    const referenceColumns = Object.keys(referenceData[0]);

    const commonColumns = currentColumns.filter(
      (column) => referenceColumns.includes(column)
    );

    if (commonColumns.length === 0) return null;

    let changedColumns = 0;

    const details = commonColumns.map((column) => {
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
        return {
          column,
          difference: 0,
          severity: "Low",
          drift: false,
        };
      }

      let difference = 0;

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

        difference =
          Math.abs(currentMean - referenceMean) /
          denominator *
          100;
      } else {
        const currentUnique = new Set(currentValues);
        const referenceUnique = new Set(referenceValues);

        let different = 0;

        currentUnique.forEach((value) => {
          if (!referenceUnique.has(value)) {
            different++;
          }
        });

        difference =
          (different /
            Math.max(currentUnique.size, 1)) *
          100;
      }

      let severity = "Low";
      let drift = false;

      if (difference >= 40) {
        severity = "High";
        drift = true;
      } else if (difference >= 20) {
        severity = "Medium";
        drift = true;
      }

      if (drift) changedColumns++;

      return {
        column,
        difference: Number(difference.toFixed(1)),
        severity,
        drift,
      };
    });

    const driftPercentage = Number(
      (
        (changedColumns / commonColumns.length) *
        100
      ).toFixed(1)
    );

    return {
      driftPercentage,
      changedColumns,
      totalColumns: commonColumns.length,
      details,
    };
  };

  const runDriftAnalysis = () => {
    const result = calculateDrift();

    if (!result) {
      alert(
        "Please upload both Reference and Current datasets first."
      );
      return;
    }

    setDriftResult(result);
    setPage("drift");
  };

  // =========================================================
  // NAVIGATION
  // =========================================================

  const navigate = (target) => {
    setPage(target);
  };

  // =========================================================
  // COLORS
  // =========================================================

  const colors = {
    bg: "#060A13",
    sidebar: "#080D18",
    card: "#0D1524",
    card2: "#101A2B",
    border: "#1B2940",
    text: "#F4F7FF",
    muted: "#8997AD",
    blue: "#3B82F6",
    purple: "#8B5CF6",
    green: "#34D399",
    yellow: "#FBBF24",
    red: "#F87171",
  };

  // =========================================================
  // STYLES
  // =========================================================

  const styles = {
    app: {
      minHeight: "100vh",
      display: "flex",
      background: colors.bg,
      color: colors.text,
      fontFamily:
        "Inter, Segoe UI, Arial, sans-serif",
    },

    sidebar: {
      width: "250px",
      background:
        "linear-gradient(180deg, #080D18 0%, #0B1220 100%)",
      borderRight: `1px solid ${colors.border}`,
      minHeight: "100vh",
      padding: "24px 18px",
      boxSizing: "border-box",
      position: "fixed",
      left: 0,
      top: 0,
      bottom: 0,
      zIndex: 20,
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
        "linear-gradient(135deg, #2563EB, #7C3AED)",
      borderRadius: "14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: "20px",
      boxShadow:
        "0 0 25px rgba(59,130,246,0.35)",
    },

    logoTitle: {
      fontSize: "20px",
      fontWeight: 800,
      color: "#F8FAFF",
    },

    logoSubtitle: {
      fontSize: "12px",
      color: "#718096",
      marginTop: "2px",
    },

    menuTitle: {
      color: "#5F6E84",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "1.5px",
      margin: "20px 0 12px",
    },

    navButton: {
      width: "100%",
      border: "1px solid transparent",
      background: "transparent",
      color: "#9AA8BE",
      padding: "13px 14px",
      borderRadius: "11px",
      textAlign: "left",
      cursor: "pointer",
      fontSize: "14px",
      marginBottom: "5px",
      transition: "all 0.25s ease",
    },

    activeNav: {
      background:
        "linear-gradient(90deg, rgba(37,99,235,0.23), rgba(124,58,237,0.15))",
      color: "#FFFFFF",
      border:
        "1px solid rgba(59,130,246,0.25)",
      boxShadow:
        "0 0 20px rgba(37,99,235,0.10)",
    },

    systemBox: {
      marginTop: "25px",
      padding: "14px",
      borderRadius: "12px",
      background: "#0B1321",
      border: `1px solid ${colors.border}`,
    },

    systemDot: {
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: colors.green,
      display: "inline-block",
      marginRight: "8px",
      boxShadow:
        "0 0 10px rgba(52,211,153,0.7)",
    },

    main: {
      marginLeft: "250px",
      width: "calc(100% - 250px)",
      minHeight: "100vh",
      background:
        "radial-gradient(circle at 80% 0%, rgba(37,99,235,0.08), transparent 30%), #060A13",
    },

    topbar: {
      height: "82px",
      background: "rgba(8,13,25,0.88)",
      backdropFilter: "blur(16px)",
      borderBottom: `1px solid ${colors.border}`,
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
      color: "#66758B",
      fontSize: "13px",
      marginBottom: "5px",
    },

    topTitle: {
      fontSize: "22px",
      fontWeight: 750,
      margin: 0,
      color: "#F1F5FF",
    },

    userArea: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },

    online: {
      color: colors.green,
      fontSize: "12px",
      marginRight: "15px",
    },

    userCircle: {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background:
        "linear-gradient(135deg, #2563EB, #7C3AED)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      boxShadow:
        "0 0 18px rgba(59,130,246,0.25)",
    },

    content: {
      padding: "30px 34px 50px",
      maxWidth: "1500px",
      margin: "0 auto",
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
      color: "#F8FAFF",
    },

    pageDescription: {
      color: "#8492A8",
      fontSize: "15px",
      margin: 0,
      lineHeight: 1.5,
    },

    datasetName: {
      color: "#6F7E95",
      marginTop: "8px",
      fontSize: "13px",
    },

    uploadButton: {
      background:
        "linear-gradient(135deg, #2563EB, #7C3AED)",
      color: "#fff",
      border: "none",
      borderRadius: "11px",
      padding: "13px 20px",
      cursor: "pointer",
      fontWeight: 650,
      fontSize: "14px",
      boxShadow:
        "0 8px 25px rgba(37,99,235,0.22)",
    },

    cards: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(210px, 1fr))",
      gap: "18px",
      marginBottom: "22px",
    },

    card: {
      background:
        "linear-gradient(145deg, #0D1524, #0A111E)",
      border: `1px solid ${colors.border}`,
      borderRadius: "16px",
      padding: "22px",
      boxSizing: "border-box",
      boxShadow:
        "0 8px 30px rgba(0,0,0,0.22)",
    },

    cardTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      color: "#8B98AE",
      fontSize: "13px",
      marginBottom: "18px",
    },

    cardIcon: {
      width: "34px",
      height: "34px",
      borderRadius: "10px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(59,130,246,0.12)",
      color: colors.blue,
    },

    cardValue: {
      fontSize: "32px",
      fontWeight: 750,
      margin: "0 0 8px",
      color: "#F4F7FF",
    },

    muted: {
      color: "#69788F",
      fontSize: "13px",
    },

    good: {
      color: colors.green,
      fontSize: "13px",
      fontWeight: 600,
    },

    warning: {
      color: colors.yellow,
      fontSize: "13px",
      fontWeight: 600,
    },

    danger: {
      color: colors.red,
      fontSize: "13px",
      fontWeight: 600,
    },

    panel: {
      background:
        "linear-gradient(145deg, #0D1524, #0A111E)",
      border: `1px solid ${colors.border}`,
      borderRadius: "16px",
      padding: "24px",
      marginBottom: "22px",
      boxShadow:
        "0 8px 30px rgba(0,0,0,0.20)",
    },

    panelHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "22px",
    },

    panelTitle: {
      margin: 0,
      fontSize: "19px",
      color: "#F1F5FF",
    },

    panelText: {
      color: "#77859C",
      marginTop: "6px",
      fontSize: "13px",
    },

    statGrid: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(180px, 1fr))",
      gap: "16px",
    },

    statBox: {
      border: `1px solid ${colors.border}`,
      borderRadius: "13px",
      padding: "18px",
      background: "#0B1321",
    },

    statLabel: {
      color: "#78869C",
      fontSize: "13px",
      marginBottom: "10px",
    },

    statValue: {
      fontSize: "27px",
      fontWeight: 750,
      color: "#F1F5FF",
    },

    progressOuter: {
      width: "100%",
      height: "7px",
      background: "#1A2638",
      borderRadius: "10px",
      overflow: "hidden",
      marginTop: "12px",
    },

    progressInner: {
      height: "100%",
      background:
        "linear-gradient(90deg, #2563EB, #8B5CF6)",
      borderRadius: "10px",
      transition: "width 1s ease",
      boxShadow:
        "0 0 12px rgba(59,130,246,0.45)",
    },

    chartGrid: {
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit, minmax(320px, 1fr))",
      gap: "20px",
    },

    chartBox: {
      background: "#0A111E",
      border: `1px solid ${colors.border}`,
      borderRadius: "13px",
      padding: "20px",
    },

    barRow: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      marginBottom: "15px",
    },

    barLabel: {
      width: "125px",
      fontSize: "12px",
      color: "#9AA8BE",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },

    barTrack: {
      flex: 1,
      height: "8px",
      background: "#172235",
      borderRadius: "10px",
      overflow: "hidden",
    },

    barFill: {
      height: "100%",
      background:
        "linear-gradient(90deg, #3B82F6, #8B5CF6)",
      borderRadius: "10px",
    },

    barNumber: {
      width: "40px",
      fontSize: "12px",
      color: "#DCE5F4",
      textAlign: "right",
    },

    table: {
      width: "100%",
      borderCollapse: "collapse",
    },

    th: {
      textAlign: "left",
      color: "#718096",
      fontSize: "12px",
      padding: "13px",
      borderBottom: `1px solid ${colors.border}`,
    },

    td: {
      padding: "14px 13px",
      borderBottom: "1px solid #151F30",
      fontSize: "13px",
      color: "#D9E2F2",
    },

    badge: {
      display: "inline-block",
      padding: "6px 11px",
      borderRadius: "20px",
      background: "#172235",
      color: "#9AA8BE",
      fontSize: "11px",
      fontWeight: 650,
    },

    healthyBadge: {
      display: "inline-block",
      padding: "6px 11px",
      borderRadius: "20px",
      background: "rgba(52,211,153,0.10)",
      color: colors.green,
      fontSize: "11px",
      fontWeight: 700,
    },

    attentionBadge: {
      display: "inline-block",
      padding: "6px 11px",
      borderRadius: "20px",
      background: "rgba(251,191,36,0.10)",
      color: colors.yellow,
      fontSize: "11px",
      fontWeight: 700,
    },

    highBadge: {
      display: "inline-block",
      padding: "6px 11px",
      borderRadius: "20px",
      background: "rgba(248,113,113,0.10)",
      color: colors.red,
      fontSize: "11px",
      fontWeight: 700,
    },

    mediumBadge: {
      display: "inline-block",
      padding: "6px 11px",
      borderRadius: "20px",
      background: "rgba(251,191,36,0.10)",
      color: colors.yellow,
      fontSize: "11px",
      fontWeight: 700,
    },

    uploadArea: {
      border: "1px dashed #33445F",
      borderRadius: "16px",
      padding: "50px 25px",
      textAlign: "center",
      background:
        "linear-gradient(145deg, #0A111E, #0D1625)",
      cursor: "pointer",
    },

    uploadIcon: {
      width: "64px",
      height: "64px",
      borderRadius: "18px",
      background:
        "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(124,58,237,0.18))",
      color: colors.blue,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "28px",
      margin: "0 auto 18px",
    },

    uploadTitle: {
      fontSize: "20px",
      color: "#F1F5FF",
      marginBottom: "8px",
    },

    uploadText: {
      color: "#718096",
      fontSize: "13px",
      marginBottom: "22px",
    },

    emptyState: {
      padding: "55px 20px",
      textAlign: "center",
      color: "#718096",
    },

    alertItem: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "15px",
      padding: "15px",
      background: "#0B1321",
      border: `1px solid ${colors.border}`,
      borderRadius: "12px",
      marginBottom: "10px",
    },

    alertLeft: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    },

    alertIcon: {
      width: "36px",
      height: "36px",
      borderRadius: "10px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(248,113,113,0.10)",
      color: colors.red,
    },

    reportCard: {
      padding: "22px",
      background: "#0B1321",
      border: `1px solid ${colors.border}`,
      borderRadius: "13px",
    },

    smallButton: {
      border: `1px solid ${colors.border}`,
      background: "#111B2C",
      color: "#DCE5F4",
      borderRadius: "9px",
      padding: "9px 13px",
      cursor: "pointer",
      fontSize: "12px",
    },

    successButton: {
      border: "none",
      background:
        "linear-gradient(135deg, #059669, #10B981)",
      color: "#fff",
      borderRadius: "9px",
      padding: "10px 15px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 650,
    },
  };

  // =========================================================
  // DASHBOARD PAGE
  // =========================================================

  const renderDashboard = () => {
    const hasAnalysis = !!analysis;
    const quality = hasAnalysis
      ? analysis.qualityScore
      : 0;

    const drift = driftResult
      ? driftResult.driftPercentage
      : 0;

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
            onClick={() => navigate("upload")}
          >
            + Upload Dataset
          </button>
        </div>

        <section style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Data Quality Score</span>

              <div style={styles.cardIcon}>
                ✓
              </div>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? `${quality}%`
                : "—"}
            </h3>

            {hasAnalysis && (
              <div style={styles.progressOuter}>
                <div
                  style={{
                    ...styles.progressInner,
                    width: `${quality}%`,
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
                ? quality >= 80
                  ? "Good quality"
                  : "Needs attention"
                : "Upload dataset to begin"}
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Data Drift</span>

              <div
                style={{
                  ...styles.cardIcon,
                  color: colors.purple,
                  background:
                    "rgba(139,92,246,0.12)",
                }}
              >
                ↗
              </div>
            </div>

            <h3 style={styles.cardValue}>
              {driftResult
                ? `${drift}%`
                : "0.0%"}
            </h3>

            <p
              style={
                drift > 20
                  ? styles.warning
                  : styles.good
              }
            >
              {driftResult
                ? drift > 20
                  ? "Drift detected"
                  : "Stable"
                : "No drift analysis yet"}
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Data Issues</span>

              <div
                style={{
                  ...styles.cardIcon,
                  color: colors.yellow,
                  background:
                    "rgba(251,191,36,0.10)",
                }}
              >
                !
              </div>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? analysis.totalIssues
                : "—"}
            </h3>

            <p style={styles.warning}>
              {hasAnalysis
                ? "Issues detected"
                : "Awaiting dataset"}
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              <span>Dataset Size</span>

              <div style={styles.cardIcon}>
                #
              </div>
            </div>

            <h3 style={styles.cardValue}>
              {hasAnalysis
                ? analysis.rows
                : "—"}
            </h3>

            <p style={styles.muted}>
              {hasAnalysis
                ? `${analysis.columns} columns`
                : "No data loaded"}
            </p>
          </div>
        </section>

        {hasAnalysis ? (
          <>
            <div style={styles.chartGrid}>
              <div style={styles.panel}>
                <div style={styles.panelHeader}>
                  <div>
                    <h3 style={styles.panelTitle}>
                      Quality Overview
                    </h3>
                    <p style={styles.panelText}>
                      Data quality dimensions
                    </p>
                  </div>
                </div>

                <div style={styles.chartBox}>
                  {[
                    ["Completeness", Math.max(0, 100 - analysis.missingValues)],
                    ["Validity", Math.max(0, 100 - analysis.totalIssues)],
                    ["Consistency", Math.max(0, 100 - analysis.duplicateValues * 5)],
                    ["Uniqueness", Math.max(0, 100 - analysis.duplicateValues * 5)],
                    ["Outlier Health", Math.max(0, 100 - analysis.outlierValues)],
                  ].map(([label, value]) => (
                    <div
                      style={styles.barRow}
                      key={label}
                    >
                      <span style={styles.barLabel}>
                        {label}
                      </span>

                      <div style={styles.barTrack}>
                        <div
                          style={{
                            ...styles.barFill,
                            width: `${Math.min(
                              100,
                              value
                            )}%`,
                          }}
                        />
                      </div>

                      <span style={styles.barNumber}>
                        {Math.round(value)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={styles.panel}>
                <div style={styles.panelHeader}>
                  <div>
                    <h3 style={styles.panelTitle}>
                      Dataset Summary
                    </h3>
                    <p style={styles.panelText}>
                      Current dataset statistics
                    </p>
                  </div>
                </div>

                <div style={styles.statGrid}>
                  <div style={styles.statBox}>
                    <div style={styles.statLabel}>
                      Rows
                    </div>
                    <div style={styles.statValue}>
                      {analysis.rows}
                    </div>
                  </div>

                  <div style={styles.statBox}>
                    <div style={styles.statLabel}>
                      Columns
                    </div>
                    <div style={styles.statValue}>
                      {analysis.columns}
                    </div>
                  </div>

                  <div style={styles.statBox}>
                    <div style={styles.statLabel}>
                      Missing
                    </div>
                    <div
                      style={{
                        ...styles.statValue,
                        color:
                          analysis.missingValues > 0
                            ? colors.yellow
                            : colors.green,
                      }}
                    >
                      {analysis.missingValues}
                    </div>
                  </div>

                  <div style={styles.statBox}>
                    <div style={styles.statLabel}>
                      Outliers
                    </div>
                    <div
                      style={{
                        ...styles.statValue,
                        color:
                          analysis.outlierValues > 0
                            ? colors.red
                            : colors.green,
                      }}
                    >
                      {analysis.outlierValues}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.panelTitle}>
                    Data Quality Alerts
                  </h3>
                  <p style={styles.panelText}>
                    Important issues found in your dataset
                  </p>
                </div>
              </div>

              {analysis.totalIssues === 0 ? (
                <div style={styles.emptyState}>
                  ✓ No major data quality issues detected.
                </div>
              ) : (
                <>
                  {analysis.missingValues > 0 && (
                    <div style={styles.alertItem}>
                      <div style={styles.alertLeft}>
                        <div style={styles.alertIcon}>
                          !
                        </div>

                        <div>
                          <strong>
                            Missing values detected
                          </strong>

                          <div style={styles.panelText}>
                            {analysis.missingValues} missing
                            value(s) found
                          </div>
                        </div>
                      </div>

                      <span style={styles.attentionBadge}>
                        Attention
                      </span>
                    </div>
                  )}

                  {analysis.outlierValues > 0 && (
                    <div style={styles.alertItem}>
                      <div style={styles.alertLeft}>
                        <div style={styles.alertIcon}>
                          !
                        </div>

                        <div>
                          <strong>
                            Outliers detected
                          </strong>

                          <div style={styles.panelText}>
                            {analysis.outlierValues} potential
                            outlier(s)
                          </div>
                        </div>
                      </div>

                      <span style={styles.highBadge}>
                        Review
                      </span>
                    </div>
                  )}

                  {analysis.duplicateValues > 0 && (
                    <div style={styles.alertItem}>
                      <div style={styles.alertLeft}>
                        <div style={styles.alertIcon}>
                          !
                        </div>

                        <div>
                          <strong>
                            Duplicate records
                          </strong>

                          <div style={styles.panelText}>
                            {analysis.duplicateValues} duplicate
                            record(s)
                          </div>
                        </div>
                      </div>

                      <span style={styles.attentionBadge}>
                        Attention
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div style={styles.panel}>
            <div style={styles.emptyState}>
              <div style={{ fontSize: "45px" }}>
                📊
              </div>

              <h3
                style={{
                  color: "#F1F5FF",
                  marginBottom: "8px",
                }}
              >
                No dataset uploaded
              </h3>

              <p>
                Upload a CSV dataset to start your
                data-quality analysis.
              </p>

              <button
                style={styles.uploadButton}
                onClick={() => navigate("upload")}
              >
                Upload Dataset
              </button>
            </div>
          </div>
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
              Upload a CSV dataset to analyze data
              quality and detect potential issues.
            </p>
          </div>
        </div>

        <div style={styles.panel}>
          <div
            style={styles.uploadArea}
            onClick={() =>
              currentInputRef.current?.click()
            }
          >
            <div style={styles.uploadIcon}>
              ↑
            </div>

            <h3 style={styles.uploadTitle}>
              Upload Current Dataset
            </h3>

            <p style={styles.uploadText}>
              Choose a CSV file from your computer.
            </p>

            <button
              style={styles.uploadButton}
              onClick={(event) => {
                event.stopPropagation();
                currentInputRef.current?.click();
              }}
            >
              Choose CSV File
            </button>

            <input
              ref={currentInputRef}
              type="file"
              accept=".csv"
              onChange={handleCurrentUpload}
              style={{ display: "none" }}
            />
          </div>
        </div>

        <div style={styles.chartGrid}>
          <div style={styles.reportCard}>
            <h3 style={styles.panelTitle}>
              Current Dataset
            </h3>

            <p style={styles.panelText}>
              Used for quality analysis.
            </p>

            <div
              style={{
                marginTop: "18px",
                color: "#DCE5F4",
              }}
            >
              {file
                ? `✓ ${file.name}`
                : "No file selected"}
            </div>
          </div>

          <div style={styles.reportCard}>
            <h3 style={styles.panelTitle}>
              Reference Dataset
            </h3>

            <p style={styles.panelText}>
              Used as the baseline for drift analysis.
            </p>

            <button
              style={{
                ...styles.smallButton,
                marginTop: "15px",
              }}
              onClick={() =>
                referenceInputRef.current?.click()
              }
            >
              Upload Reference CSV
            </button>

            <input
              ref={referenceInputRef}
              type="file"
              accept=".csv"
              onChange={handleReferenceUpload}
              style={{ display: "none" }}
            />

            <div
              style={{
                marginTop: "12px",
                color: "#DCE5F4",
                fontSize: "13px",
              }}
            >
              {referenceFile
                ? `✓ ${referenceFile.name}`
                : "No reference file"}
            </div>
          </div>
        </div>
      </>
    );
  };

  // =========================================================
  // DATA QUALITY PAGE
  // =========================================================

  const renderQualityPage = () => {
    if (!analysis) {
      return (
        <div style={styles.panel}>
          <div style={styles.emptyState}>
            <div style={{ fontSize: "45px" }}>
              🔍
            </div>

            <h3
              style={{
                color: "#F1F5FF",
              }}
            >
              No dataset available
            </h3>

            <p>
              Upload a CSV dataset to view detailed
              quality analysis.
            </p>

            <button
              style={styles.uploadButton}
              onClick={() => navigate("upload")}
            >
              Upload Dataset
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Data Quality
            </h2>

            <p style={styles.pageDescription}>
              Detailed quality analysis of your uploaded
              dataset.
            </p>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Overall Quality
            </div>

            <div style={styles.cardValue}>
              {analysis.qualityScore}%
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

        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTop}>
              Completeness
            </div>
            <div style={styles.cardValue}>
              {Math.max(
                0,
                100 - analysis.missingValues
              ).toFixed(1)}
              %
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Missing Values
            </div>
            <div
              style={{
                ...styles.cardValue,
                color:
                  analysis.missingValues > 0
                    ? colors.yellow
                    : colors.green,
              }}
            >
              {analysis.missingValues}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Duplicate Records
            </div>
            <div
              style={{
                ...styles.cardValue,
                color:
                  analysis.duplicateValues > 0
                    ? colors.yellow
                    : colors.green,
              }}
            >
              {analysis.duplicateValues}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Outliers
            </div>
            <div
              style={{
                ...styles.cardValue,
                color:
                  analysis.outlierValues > 0
                    ? colors.red
                    : colors.green,
              }}
            >
              {analysis.outlierValues}
            </div>
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h3 style={styles.panelTitle}>
                Column Quality Analysis
              </h3>

              <p style={styles.panelText}>
                Quality status for every dataset column.
              </p>
            </div>
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
                      <td style={styles.td}>
                        <strong>
                          {column.name}
                        </strong>
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
                            ✓ Healthy
                          </span>
                        ) : (
                          <span
                            style={
                              styles.attentionBadge
                            }
                          >
                            ! Needs Attention
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  };

  // =========================================================
  // DRIFT PAGE
  // =========================================================

  const renderDriftPage = () => {
    const result =
      driftResult || calculateDrift();

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Data Drift
            </h2>

            <p style={styles.pageDescription}>
              Compare your current dataset with a
              reference dataset to identify distribution
              changes.
            </p>
          </div>

          <button
            style={styles.uploadButton}
            onClick={() =>
              referenceInputRef.current?.click()
            }
          >
            + Reference Dataset
          </button>

          <input
            ref={referenceInputRef}
            type="file"
            accept=".csv"
            onChange={handleReferenceUpload}
            style={{ display: "none" }}
          />
        </div>

        <div style={styles.cards}>
          <div style={styles.card}>
            <div style={styles.cardTop}>
              Reference Dataset
            </div>

            <div
              style={{
                fontSize: "15px",
                fontWeight: 650,
                color: "#DCE5F4",
              }}
            >
              {referenceFile
                ? referenceFile.name
                : "Not uploaded"}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Current Dataset
            </div>

            <div
              style={{
                fontSize: "15px",
                fontWeight: 650,
                color: "#DCE5F4",
              }}
            >
              {file
                ? file.name
                : "Not uploaded"}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Drift Percentage
            </div>

            <div style={styles.cardValue}>
              {result
                ? `${result.driftPercentage}%`
                : "—"}
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTop}>
              Drifted Columns
            </div>

            <div style={styles.cardValue}>
              {result
                ? `${result.changedColumns}/${result.totalColumns}`
                : "—"}
            </div>
          </div>
        </div>

        {!analysis || !referenceData ? (
          <div style={styles.panel}>
            <div style={styles.emptyState}>
              <div style={{ fontSize: "45px" }}>
                📈
              </div>

              <h3
                style={{
                  color: "#F1F5FF",
                }}
              >
                Upload both datasets
              </h3>

              <p>
                You need a reference dataset and a
                current dataset to calculate drift.
              </p>

              <button
                style={styles.uploadButton}
                onClick={() => navigate("upload")}
              >
                Upload Datasets
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.panelTitle}>
                    Drift Analysis
                  </h3>

                  <p style={styles.panelText}>
                    Statistical comparison between
                    reference and current data.
                  </p>
                </div>

                <button
                  style={styles.successButton}
                  onClick={runDriftAnalysis}
                >
                  Run Analysis
                </button>
              </div>

              <div style={styles.chartBox}>
                {result &&
                  result.details.map((item) => (
                    <div
                      style={styles.barRow}
                      key={item.column}
                    >
                      <span style={styles.barLabel}>
                        {item.column}
                      </span>

                      <div style={styles.barTrack}>
                        <div
                          style={{
                            ...styles.barFill,
                            width: `${Math.min(
                              item.difference,
                              100
                            )}%`,
                            background:
                              item.severity === "High"
                                ? "linear-gradient(90deg,#EF4444,#F97316)"
                                : item.severity ===
                                  "Medium"
                                ? "linear-gradient(90deg,#F59E0B,#FBBF24)"
                                : "linear-gradient(90deg,#3B82F6,#8B5CF6)",
                          }}
                        />
                      </div>

                      <span style={styles.barNumber}>
                        {item.difference}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.panelTitle}>
                    Drifted Columns
                  </h3>

                  <p style={styles.panelText}>
                    Columns with significant changes.
                  </p>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>
                        Column
                      </th>

                      <th style={styles.th}>
                        Change
                      </th>

                      <th style={styles.th}>
                        Severity
                      </th>

                      <th style={styles.th}>
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {result &&
                      result.details.map(
                        (item) => (
                          <tr key={item.column}>
                            <td style={styles.td}>
                              <strong>
                                {item.column}
                              </strong>
                            </td>

                            <td style={styles.td}>
                              {item.difference}%
                            </td>

                            <td style={styles.td}>
                              {item.severity ===
                              "High" ? (
                                <span
                                  style={
                                    styles.highBadge
                                  }
                                >
                                  HIGH
                                </span>
                              ) : item.severity ===
                                "Medium" ? (
                                <span
                                  style={
                                    styles.mediumBadge
                                  }
                                >
                                  MEDIUM
                                </span>
                              ) : (
                                <span
                                  style={
                                    styles.healthyBadge
                                  }
                                >
                                  LOW
                                </span>
                              )}
                            </td>

                            <td style={styles.td}>
                              {item.drift ? (
                                <span
                                  style={
                                    styles.highBadge
                                  }
                                >
                                  Drift Detected
                                </span>
                              ) : (
                                <span
                                  style={
                                    styles.healthyBadge
                                  }
                                >
                                  Stable
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </>
    );
  };

  // =========================================================
  // REPORT PAGE
  // =========================================================

  const renderReportsPage = () => {
    const drift = driftResult
      ? driftResult.driftPercentage
      : 0;

    return (
      <>
        <div style={styles.pageIntro}>
          <div>
            <h2 style={styles.pageHeading}>
              Reports
            </h2>

            <p style={styles.pageDescription}>
              Summary of your data quality and drift
              analysis.
            </p>
          </div>
        </div>

        {!analysis ? (
          <div style={styles.panel}>
            <div style={styles.emptyState}>
              <div style={{ fontSize: "45px" }}>
                📄
              </div>

              <h3
                style={{
                  color: "#F1F5FF",
                }}
              >
                No report available
              </h3>

              <p>
                Upload and analyze a dataset first.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.cards}>
              <div style={styles.card}>
                <div style={styles.cardTop}>
                  Overall Quality
                </div>

                <div style={styles.cardValue}>
                  {analysis.qualityScore}%
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardTop}>
                  Drift
                </div>

                <div style={styles.cardValue}>
                  {drift}%
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardTop}>
                  Issues
                </div>

                <div style={styles.cardValue}>
                  {analysis.totalIssues}
                </div>
              </div>
            </div>

            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.panelTitle}>
                    Data Quality Report
                  </h3>

                  <p style={styles.panelText}>
                    Generated from the uploaded dataset.
                  </p>
                </div>

                <button
                  style={styles.smallButton}
                  onClick={() =>
                    window.print()
                  }
                >
                  Print / Save PDF
                </button>
              </div>

              <div style={styles.reportCard}>
                <h3
                  style={{
                    color: "#F1F5FF",
                  }}
                >
                  Dataset Information
                </h3>

                <p style={styles.panelText}>
                  Dataset:{" "}
                  <strong>
                    {file?.name || "Unknown"}
                  </strong>
                </p>

                <p style={styles.panelText}>
                  Rows:{" "}
                  <strong>
                    {analysis.rows}
                  </strong>
                </p>

                <p style={styles.panelText}>
                  Columns:{" "}
                  <strong>
                    {analysis.columns}
                  </strong>
                </p>

                <p style={styles.panelText}>
                  Quality Score:{" "}
                  <strong>
                    {analysis.qualityScore}%
                  </strong>
                </p>

                <hr
                  style={{
                    border: 0,
                    borderTop:
                      "1px solid #1B2940",
                    margin: "20px 0",
                  }}
                />

                <h3
                  style={{
                    color: "#F1F5FF",
                  }}
                >
                  Detected Issues
                </h3>

                <p style={styles.panelText}>
                  Missing Values:{" "}
                  <strong>
                    {analysis.missingValues}
                  </strong>
                </p>

                <p style={styles.panelText}>
                  Duplicate Records:{" "}
                  <strong>
                    {analysis.duplicateValues}
                  </strong>
                </p>

                <p style={styles.panelText}>
                  Outliers:{" "}
                  <strong>
                    {analysis.outlierValues}
                  </strong>
                </p>

                <hr
                  style={{
                    border: 0,
                    borderTop:
                      "1px solid #1B2940",
                    margin: "20px 0",
                  }}
                />

                <h3
                  style={{
                    color: "#F1F5FF",
                  }}
                >
                  Recommendation
                </h3>

                <p
                  style={{
                    color: "#8FA0B8",
                    lineHeight: 1.7,
                  }}
                >
                  {analysis.totalIssues === 0
                    ? "The dataset currently appears healthy. Continue monitoring data quality regularly."
                    : "Review the detected missing values, duplicate records and outliers before using the dataset for downstream analytics or machine-learning workflows."}
                </p>
              </div>
            </div>
          </>
        )}
      </>
    );
  };

  // =========================================================
  // PAGE TITLE
  // =========================================================

  const getPageTitle = () => {
    if (page === "dashboard")
      return "Dashboard";

    if (page === "upload")
      return "Upload Dataset";

    if (page === "quality")
      return "Data Quality";

    if (page === "drift")
      return "Data Drift";

    if (page === "reports")
      return "Reports";

    return "Dashboard";
  };

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div style={styles.app}>
      {/* SIDEBAR */}

      <aside style={styles.sidebar}>
        <div style={styles.logoRow}>
          <div style={styles.logo}>
            ◈
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
          onClick={() => navigate("dashboard")}
        >
          ◉ &nbsp; Dashboard
        </button>

        <button
          style={{
            ...styles.navButton,
            ...(page === "upload"
              ? styles.activeNav
              : {}),
          }}
          onClick={() => navigate("upload")}
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
          onClick={() => navigate("quality")}
        >
          ◈ &nbsp; Data Quality
        </button>

        <button
          style={{
            ...styles.navButton,
            ...(page === "drift"
              ? styles.activeNav
              : {}),
          }}
          onClick={() => navigate("drift")}
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
          onClick={() => navigate("reports")}
        >
          ▤ &nbsp; Reports
        </button>

        <div style={styles.menuTitle}>
          SYSTEM
        </div>

        <div style={styles.systemBox}>
          <span style={styles.systemDot} />

          <span
            style={{
              color: "#C6D1E1",
              fontSize: "12px",
            }}
          >
            Analysis Engine Online
          </span>

          <div
            style={{
              color: "#66758B",
              fontSize: "10px",
              marginTop: "6px",
              marginLeft: "16px",
            }}
          >
            Ready for dataset analysis
          </div>
        </div>
      </aside>

      {/* MAIN */}

      <main style={styles.main}>
        {/* TOP BAR */}

        <header style={styles.topbar}>
          <div>
            <div style={styles.breadcrumb}>
              DataGuard / {getPageTitle()}
            </div>

            <h1 style={styles.topTitle}>
              {getPageTitle()}
            </h1>
          </div>

          <div style={styles.userArea}>
            <span style={styles.online}>
              ● System Online
            </span>

            <div style={styles.userCircle}>
              R
            </div>

            <div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 650,
                  color: "#DCE5F4",
                }}
              >
                Rashika
              </div>

              <div
                style={{
                  fontSize: "10px",
                  color: "#68778D",
                }}
              >
                Data Engineer
              </div>
            </div>
          </div>
        </header>

        {/* CONTENT */}

        <div style={styles.content}>
          {page === "dashboard" &&
            renderDashboard()}

          {page === "upload" &&
            renderUploadPage()}

          {page === "quality" &&
            renderQualityPage()}

          {page === "drift" &&
            renderDriftPage()}

          {page === "reports" &&
            renderReportsPage()}
        </div>
      </main>
    </div>
  );
}

export default App;