document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileCountry");
  fileInput.addEventListener("change", (event) => {
    showLoadingScreen();
    handleCountryTaggingFile(event);
  });
});

/** Full-page “please wait” overlay */
function showLoadingScreen() {
  const overlay = document.createElement("div");
  overlay.id = "loadingOverlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0", left: "0",
    width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
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

/** Remove the overlay */
function hideLoadingScreen() {
  const o = document.getElementById("loadingOverlay");
  if (o) o.remove();
}

/** Read the selected file and hand off the rows */
function handleCountryTaggingFile(event) {
  const file = event.target.files[0];
  if (!file) {
    hideLoadingScreen();
    return;
  }
  const reader = new FileReader();
  reader.onerror = (err) => {
    console.error("FileReader error:", err);
    alert("Error reading file.");
    hideLoadingScreen();
  };
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb   = XLSX.read(data, { type: "array" });
      if (!wb.SheetNames.length) throw new Error("No sheets found");
      const sheet    = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      if (!jsonData.length) {
        alert("No data found.");
        hideLoadingScreen();
        return;
      }
      processCountryTaggingFile(jsonData);
    } catch (err) {
      console.error("Processing error:", err);
      alert("Error processing file. Check format and retry.");
      hideLoadingScreen();
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Main pipeline:
 *   1) Group in integer cents by all keys (incl. Facility & Country)
 *   2) Extract raw “Max Bill Adjustment” cents
 *   3) For each base line:
 *       • build availableUnitsCents
 *       • distribute as much as possible into (Country|Facility)
 *       • if rawAdj > allocated, append a placeholder row for leftover
 *   4) Build XLSX and download
 */
function processCountryTaggingFile(data) {
  try {
    // ---- 1) GROUP INTO CENTS ----
    const toCents = hrs => Math.round(parseFloat(hrs) * 100);
    const groupedCents = {};
    data.forEach(row => {
      const key =
        `${row.PO}|${row["Work City"]}|${row.Project}|${row["Planning Group"]}` +
        `|${row.Role}|${row.Level}|${row.Language}|${row.Week}` +
        `|${row["Facility Code"]}|${row.Country}`;
      groupedCents[key] = (groupedCents[key] || 0) + toCents(row.Hours || 0);
    });

    // ---- 2) EXTRACT RAW ADJUSTMENTS ----
    const FAC_PLACEHOLDER = "No Assigned Facility Code Yet";
    const CTR_PLACEHOLDER = "No Assigned Country Yet";
    const placeholderSuffix = `|${FAC_PLACEHOLDER}|${CTR_PLACEHOLDER}`;

    // raw adjustments per baseKey (in cents)
    const rawAdjCentsMap = {};
    for (const key in groupedCents) {
      if (key.endsWith(placeholderSuffix)) {
        const baseKey = key.slice(0, -placeholderSuffix.length);
        rawAdjCentsMap[baseKey] = (rawAdjCentsMap[baseKey] || 0)
                                 + Math.abs(groupedCents[key]);
      }
    }

    // keep only real buckets
    const validCents = {};
    for (const key in groupedCents) {
      if (!key.endsWith(placeholderSuffix)) {
        validCents[key] = groupedCents[key];
      }
    }

    // ---- 3) DISTRIBUTE & CAPTURE LEFTOVERS ----
    const adjustmentRows = [];
    Object.entries(rawAdjCentsMap).forEach(([baseKey, rawCents]) => {
      // collect that line’s valid buckets
      const buckets = Object.entries(validCents)
        .filter(([k]) => k.startsWith(baseKey + "|"));

      // build availability map
      const availableUnitsCents = {};
      buckets.forEach(([k, cents]) => {
        const parts    = k.split("|");
        const country  = parts.pop();
        const facility = parts.pop();
        const unitKey  = `${country}|${facility}`;
        availableUnitsCents[unitKey] = (availableUnitsCents[unitKey] || 0) + cents;
      });

      // 3a) run pure-integer distribution
      const allocations = distributePlacementCents(rawCents, availableUnitsCents);

      // 3b) emit one adjustment row per (Country|Facility)
      let allocatedSum = 0;
      Object.entries(allocations).forEach(([unitKey, centsDeducted]) => {
        if (centsDeducted > 0) {
          allocatedSum += centsDeducted;
          const [country, facility] = unitKey.split("|");
          adjustmentRows.push([
            "Max Bill Adjustment",
            ...baseKey.split("|"),
            facility,
            country,
            -(centsDeducted / 100)   // back to hours
          ]);
        }
      });

      // 3c) if there’s any leftover cents, stick them on the placeholder bucket
      const leftover = rawCents - allocatedSum;
      if (leftover > 0) {
        adjustmentRows.push([
          "Max Bill Adjustment",
          ...baseKey.split("|"),
          FAC_PLACEHOLDER,
          CTR_PLACEHOLDER,
          -(leftover / 100)
        ]);
      }
    });

    // ---- 4) BUILD OUTPUT & DOWNLOAD ----
    const header = [
      "Type of Hours","PO","Work City","Project","Planning Group",
      "Role","Level","Language","Week",
      "Facility Code","Country","Total Hours"
    ];
    const output = [header];

    // SRT rows
    Object.keys(validCents).sort().forEach(key => {
      output.push([
        "SRT", 
        ...key.split("|"), 
        validCents[key] / 100
      ]);
    });

    // Adjustment rows
    adjustmentRows
      .sort((a,b) => a.join("|").localeCompare(b.join("|")))
      .forEach(r => output.push(r));

    const ws  = XLSX.utils.aoa_to_sheet(output);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws, "Country-Facility Adjustment");
    const buf = XLSX.write(wb2, { bookType:"xlsx", type:"array" });

    downloadFile(
      new Blob([buf], { type: "application/octet-stream" }),
      "Facility-Country-Tagged.xlsx"
    );
  } catch (err) {
    console.error(err);
    alert("Error processing data; please check the file.");
  } finally {
    hideLoadingScreen();
  }
}

/**
 * Pure-integer distribution of adjCents across availableUnitsCents:
 *   • Two tiers (PH/IN first, then US/CA/IL)
 *   • Floor-divide for equal share, then distribute actual leftover
 *   • Final sweep to correct any single-cent errors
 *
 * @param {number} adjCents
 * @param {Record<string,number>} availableUnitsCents
 * @returns {Record<string,number>} deductions in cents
 */
function distributePlacementCents(adjCents, availableUnitsCents) {
  const unitKeys = Object.keys(availableUnitsCents);
  const tiers = [
    ["Philippines","India"],
    ["United States","Canada","Israel"]
  ];

  // clone capacities
  const origCap = {}, availCap = {};
  unitKeys.forEach(k => {
    origCap[k]  = availableUnitsCents[k];
    availCap[k] = availableUnitsCents[k];
  });

  // init deductions
  const deductions = Object.fromEntries(unitKeys.map(k=>[k,0]));
  let remaining = adjCents;

  // distribute for one tier
  function distTier(countries) {
    const active = unitKeys.filter(k => {
      const country = k.split("|")[0];
      return countries.includes(country) && availCap[k] > 0;
    });
    const n = active.length;
    if (!n) return 0;

    // 1) floor-share
    const share = Math.floor(remaining / n);
    let allocated = 0;
    active.forEach(k => {
      const give = Math.min(availCap[k], share);
      deductions[k] += give;
      availCap[k] -= give;
      allocated += give;
    });

    // 2) true leftover = remaining - allocated
    let leftover = remaining - allocated;
    for (let i = 0; i < leftover; i++) {
      for (const k of active) {
        if (availCap[k] > 0) {
          deductions[k]++;
          availCap[k]--;
          allocated++;
          break;
        }
      }
    }

    return allocated;
  }

  // apply both tiers
  tiers.forEach(tier => {
    let got;
    do {
      got = distTier(tier);
      remaining -= got;
    } while (got > 0 && remaining > 0);
  });

  // final cent-correction
  let centError = adjCents - Object.values(deductions).reduce((s,v)=>s+v,0);
  while (centError !== 0) {
    let any = false;
    for (const k of unitKeys) {
      if (centError > 0 && deductions[k] < origCap[k]) {
        deductions[k]++;
        centError--;
        any = true;
      } else if (centError < 0 && deductions[k] > 0) {
        deductions[k]--;
        centError++;
        any = true;
      }
      if (centError === 0) break;
    }
    if (!any) break;
  }

  return deductions;
}

/** Trigger file download */
function downloadFile(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
