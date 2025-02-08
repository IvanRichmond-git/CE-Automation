document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("fileCountry");
    fileInput.addEventListener("change", (event) => {
      showLoadingScreen();
      handleCountryTaggingFile(event);
    });
  });
  
  /**
   * Displays a full-page loading overlay.
   */
  function showLoadingScreen() {
    const overlay = document.createElement("div");
    overlay.id = "loadingOverlay";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      color: "white",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      fontSize: "24px",
      zIndex: "9999",
    });
    overlay.innerText = "Please wait while the file is being prepared...";
    document.body.appendChild(overlay);
  }
  
  /**
   * Hides the loading overlay if it exists.
   */
  function hideLoadingScreen() {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.remove();
  }
  
  /**
   * Reads the selected file and triggers processing.
   */
  function handleCountryTaggingFile(event) {
    const file = event.target.files[0];
    if (!file) {
      hideLoadingScreen();
      return;
    }
  
    const reader = new FileReader();
  
    // Catch file reading errors.
    reader.onerror = (error) => {
      console.error("Error reading file:", error);
      alert("An error occurred while reading the file. Please try a different file.");
      hideLoadingScreen();
    };
  
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
  
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("No sheets found in the Excel file.");
        }
  
        const firstSheet = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheet];
        const jsonData = XLSX.utils.sheet_to_json(sheet);
  
        // Check for empty data.
        if (!jsonData || jsonData.length === 0) {
          alert("The file does not contain any data.");
          hideLoadingScreen();
          return;
        }
  
        processCountryTaggingFile(jsonData);
      } catch (error) {
        console.error("Error processing file:", error);
        alert("There was an error processing the file. Please ensure the file is valid and try again.");
        hideLoadingScreen();
      }
    };
  
    reader.readAsArrayBuffer(file);
  }
  
  /**
   * Processes the country tagging file data.
   * 
   * Step 1: Groups rows by line item. The line item key is defined as:
   *         PO|Work City|Project|Planning Group|Role|Level|Language|Week|Country
   *         (Each line item now shows the total hours.)
   * 
   * Step 2: Extracts any Max Bill Adjustment rows (where Country is "No Assigned Country Yet")
   *         and maps them to their base line item (all fields except Country).
   * 
   * Step 3: For each base line item, distributes the Max Bill Adjustment among the available
   *         countries following these rules:
   *           - Philippines and India share the adjustment equally until one (or both) is exhausted.
   *           - Any remaining adjustment is split equally among United States, Canada, and Israel.
   */
  function processCountryTaggingFile(data) {
    try {
      // --- Step 1: Group data by line item ---
      const groupedData = {};
      data.forEach((row) => {
        // Build the key using the defined fields.
        const key = `${row.PO}|${row["Work City"]}|${row.Project}|${row["Planning Group"]}|${row.Role}|${row.Level}|${row.Language}|${row.Week}|${row.Country}`;
        const hours = parseFloat(row.Hours) || 0;
        if (!groupedData[key]) {
          groupedData[key] = { hours: 0 };
        }
        groupedData[key].hours += hours;
      });
  
      // --- Step 2: Extract Max Bill Adjustments ---
      // These are the rows where the Country is "No Assigned Country Yet".
      const maxBillAdjustments = {};
      for (const key in groupedData) {
        if (key.endsWith("|No Assigned Country Yet")) {
          // Remove the "No Assigned Country Yet" part to get the base line item key.
          const baseKey = key.replace("|No Assigned Country Yet", "");
          // Sum adjustments if there are multiple (using absolute value).
          maxBillAdjustments[baseKey] = (maxBillAdjustments[baseKey] || 0) + Math.abs(groupedData[key].hours);
        }
      }
  
      // Remove "No Assigned Country Yet" entries from the grouped data so they don’t appear in the final output.
      const validGroupedData = {};
      for (const key in groupedData) {
        if (!key.endsWith("|No Assigned Country Yet")) {
          validGroupedData[key] = groupedData[key];
        }
      }
  
      // --- Step 3: Distribute the Max Bill Adjustments ---
      const adjustmentRows = [];
      for (const baseKey in maxBillAdjustments) {
        const adjustment = maxBillAdjustments[baseKey];
  
        // Find all valid entries for this base line item.
        const matchingEntries = Object.entries(validGroupedData).filter(([key]) =>
          key.startsWith(baseKey)
        );
  
        // Map available hours per country from the matching entries.
        const countryHours = {};
        matchingEntries.forEach(([key, value]) => {
          const segments = key.split("|");
          const country = segments[segments.length - 1];
          countryHours[country] = value.hours;
        });
  
        // Distribute the adjustment according to the rules.
        const deductions = distributeAdjustment(adjustment, countryHours);
  
        // Create adjustment rows (only if a country is absorbing part of the adjustment).
        for (const country in deductions) {
          const deducted = deductions[country];
          if (deducted > 0) {
            // The adjustment is output as a negative number.
            adjustmentRows.push(["Max Bill Adjustment", ...baseKey.split("|"), country, -deducted]);
          }
        }
      }
  
      // --- Prepare the output rows ---
      const header = [
        "Type of Hours",
        "PO",
        "Work City",
        "Project",
        "Planning Group",
        "Role",
        "Level",
        "Language",
        "Week",
        "Country",
        "Total Hours",
      ];
      const outputRows = [header];
  
      // Add the valid grouped rows (sorted for consistency).
      Object.keys(validGroupedData)
        .sort()
        .forEach((key) => {
          const segments = key.split("|");
          outputRows.push(["SRT", ...segments, validGroupedData[key].hours]);
        });
  
      // Append the adjustment rows (sorted if needed).
      adjustmentRows
        .sort((a, b) => a.join("|").localeCompare(b.join("|")))
        .forEach((row) => outputRows.push(row));
  
      // --- Generate and download the Excel file ---
      const worksheet = XLSX.utils.aoa_to_sheet(outputRows);
      const newWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWorkbook, worksheet, "Country Adjustment Output");
      const excelBuffer = XLSX.write(newWorkbook, { bookType: "xlsx", type: "array" });
      downloadFile(
        new Blob([excelBuffer], { type: "application/octet-stream" }),
        "Country-Tagged.xlsx"
      );
    } catch (error) {
      console.error("Error processing data:", error);
      alert("An error occurred while processing the file. Please check the file format and try again.");
    } finally {
      hideLoadingScreen();
    }
  }
  
  /**
   * Distributes the max bill adjustment among countries based on available hours.
   *
   * Rules:
   *   1. Philippines and India share the adjustment equally until one or both are exhausted.
   *   2. Any remaining adjustment is split equally among United States, Canada, and Israel.
   *
   * If the requested adjustment exceeds the total available hours, it will be capped.
   *
   * After distribution, we adjust for floating-point precision errors so that the total
   * distributed adjustment exactly equals the requested adjustment.
   *
   * @param {number} adjustment - The total adjustment to distribute (absolute value).
   * @param {object} availableHours - An object mapping country names to available hours.
   * @returns {object} deductions - An object mapping each country to the number of hours deducted.
   */
  function distributeAdjustment(adjustment, availableHours) {
    // Create a mutable copy of available hours.
    const available = { ...availableHours };
  
    // Ensure keys for the expected countries exist.
    const allCountries = ["Philippines", "India", "United States", "Canada", "Israel"];
    allCountries.forEach((country) => {
      if (available[country] === undefined) {
        available[country] = 0;
      }
    });
  
    // Calculate total available hours.
    const totalAvailable = allCountries.reduce((sum, country) => sum + available[country], 0);
    if (adjustment > totalAvailable) {
      console.warn(
        `Requested adjustment ${adjustment} exceeds total available hours ${totalAvailable}. Adjusting to ${totalAvailable}.`
      );
      adjustment = totalAvailable;
    }
  
    // Initialize deductions for all countries.
    const deductions = {
      Philippines: 0,
      India: 0,
      "United States": 0,
      Canada: 0,
      Israel: 0,
    };
  
    let remaining = adjustment;
    const epsilon = 1e-6; // Tolerance for floating point comparisons.
  
    // --- Step 3.a: Deduct equally from Philippines and India ---
    while (
      remaining > epsilon &&
      (available["Philippines"] > epsilon || available["India"] > epsilon)
    ) {
      const share = remaining / 2;
      const phDeduct = Math.min(available["Philippines"], share);
      const inDeduct = Math.min(available["India"], remaining - phDeduct);
      deductions["Philippines"] += phDeduct;
      deductions["India"] += inDeduct;
      remaining -= phDeduct + inDeduct;
      available["Philippines"] -= phDeduct;
      available["India"] -= inDeduct;
  
      if (available["Philippines"] < epsilon && available["India"] < epsilon) {
        break;
      }
    }
  
    // --- Step 3.b: Distribute any remaining adjustment among fallback countries ---
    const fallbackCountries = ["United States", "Canada", "Israel"];
    let remainingFallback = fallbackCountries.filter((country) => available[country] > epsilon);
  
    while (remaining > epsilon && remainingFallback.length > 0) {
      const share = remaining / remainingFallback.length;
      for (const country of remainingFallback) {
        const take = Math.min(available[country], share);
        deductions[country] += take;
        remaining -= take;
        available[country] -= take;
      }
      // Update the fallback list in case some countries are exhausted.
      remainingFallback = fallbackCountries.filter((country) => available[country] > epsilon);
    }
  
    // --- Final Adjustment to Fix Floating-Point Rounding ---
    // Sum up the distributed deductions.
    let totalDeducted = allCountries.reduce((sum, country) => sum + deductions[country], 0);
    let error = adjustment - totalDeducted;
    if (Math.abs(error) > epsilon) {
      // Add the error to the first country that already has a nonzero deduction,
      // or fallback to "Philippines".
      for (const country of allCountries) {
        if (deductions[country] > epsilon) {
          deductions[country] += error;
          break;
        }
      }
    }
  
    // --- Round each country's deduction to two decimal places ---
    allCountries.forEach((country) => {
      deductions[country] = Math.round(deductions[country] * 100) / 100;
    });
  
    return deductions;
  }
  
  /**
   * Creates a temporary download link for the file blob and triggers the download.
   */
  function downloadFile(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  