document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileCountry");
  fileInput.addEventListener("change", (event) => {
    showLoadingScreen();
    handleCountryTaggingFile(event);
  });
});

// Up to 8 decimal places of precision
const PRECISION = 100_000_000;
const FAC_PLACEHOLDER = "No Assigned Facility Code Yet";
const CTR_PLACEHOLDER = "No Assigned Country Yet";

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

/** Safely parse hours to a scaled integer (up to 8 decimal places) */
function toScaledHours(hrs) {
  const v = Number(hrs);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * PRECISION);
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
 * Main pipeline (fast version):
 *   1) Single pass over rows to build:
 *        baseMap[baseKey] = {
 *          parts: [PO, Work City, Project, Planning Group, Role, Level, Language, Week],
 *          buckets: { "Country|Facility": scaledHours },
 *          rawAdjUnits: total placeholder adjustment (scaled)
 *        }
 *   2) For each baseKey:
 *        • emit SRT rows from buckets
 *        • distribute rawAdjUnits over buckets (tiered by country)
 *        • emit Max Bill Adjustment rows + placeholder for any leftover
 *   3) Build XLSX and download
 */
function processCountryTaggingFile(data) {
  try {
    // ---- 1) BUILD BASE MAP IN ONE PASS ----
    /** @type {Record<string,{parts:string[], buckets:Record<string,number>, rawAdjUnits:number}>} */
    const baseMap = {};

    data.forEach(row => {
      const units = toScaledHours(row.Hours || 0);
      if (!units) return;

      const parts = [
        row.PO,
        row["Work City"],
        row.Project,
        row["Planning Group"],
        row.Role,
        row.Level,
        row.Language,
        row.Week
      ];

      const baseKey = parts.join("|");
      let base = baseMap[baseKey];
      if (!base) {
        base = { parts, buckets: {}, rawAdjUnits: 0 };
        baseMap[baseKey] = base;
      }

      const facility = row["Facility Code"] ?? FAC_PLACEHOLDER;
      const country  = row.Country ?? CTR_PLACEHOLDER;

      // Placeholder rows (no facility + no country) are raw Max Bill Adjustment
      if (facility === FAC_PLACEHOLDER && country === CTR_PLACEHOLDER) {
        base.rawAdjUnits += Math.abs(units);
      } else {
        const unitKey = `${country}|${facility}`;
        base.buckets[unitKey] = (base.buckets[unitKey] || 0) + units;
      }
    });

    // ---- 2) BUILD ROWS ----
    const header = [
      "Type of Hours","PO","Work City","Project","Planning Group",
      "Role","Level","Language","Week",
      "Facility Code","Country","Total Hours"
    ];

    const srtRows = [];
    const adjustmentRows = [];

    Object.values(baseMap).forEach(base => {
      const { parts, buckets, rawAdjUnits } = base;

      // 2a) SRT rows (grouped per Country|Facility)
      Object.entries(buckets).forEach(([unitKey, units]) => {
        if (!units) return;
        const [country, facility] = unitKey.split("|");
        srtRows.push([
          "SRT",
          ...parts,
          facility,
          country,
          units / PRECISION
        ]);
      });

      // 2b) Adjustment rows (tiered distribution)
      if (rawAdjUnits > 0) {
        const allocations = distributePlacementUnits(rawAdjUnits, buckets);
        let allocatedSum = 0;

        Object.entries(allocations).forEach(([unitKey, units]) => {
          if (units <= 0) return;
          allocatedSum += units;
          const [country, facility] = unitKey.split("|");
          adjustmentRows.push([
            "Max Bill Adjustment",
            ...parts,
            facility,
            country,
            -(units / PRECISION)
          ]);
        });

        const leftover = rawAdjUnits - allocatedSum;
        if (leftover > 0) {
          adjustmentRows.push([
            "Max Bill Adjustment",
            ...parts,
            FAC_PLACEHOLDER,
            CTR_PLACEHOLDER,
            -(leftover / PRECISION)
          ]);
        }
      }
    });

    // Optional: sort for readability (can remove for slightly more speed)
    srtRows.sort((a, b) => a.slice(1, -1).join("|").localeCompare(b.slice(1, -1).join("|")));
    adjustmentRows.sort((a, b) => a.slice(1, -1).join("|").localeCompare(b.slice(1, -1).join("|")));

    const output = [header, ...srtRows, ...adjustmentRows];

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
 * Fast, tiered distribution of adjUnits across availableUnits:
 *
 *   • Still respects 8-decimal precision (integer scaled by PRECISION).
 *   • Two tiers:
 *       1) Philippines, India
 *       2) United States, Canada, Israel
 *   • Within a tier, distributes proportionally to availableUnits (capacity),
 *     then fixes small rounding errors with a tiny integer correction.
 *
 * @param {number} adjUnits  total adjustment in scaled units
 * @param {Record<string,number>} availableUnits  "Country|Facility" -> scaled capacity
 * @returns {Record<string,number>} allocations (deductions) in scaled units
 */
function distributePlacementUnits(adjUnits, availableUnits) {
  const unitKeys = Object.keys(availableUnits);

  // Initialize capacities and deductions
  const origCap = {};
  unitKeys.forEach(k => {
    const cap = Number(availableUnits[k]) || 0;
    origCap[k] = cap > 0 ? cap : 0;
  });

  const deductions = Object.fromEntries(unitKeys.map(k => [k, 0]));
  let remaining = adjUnits;

  if (!Number.isFinite(remaining) || remaining <= 0 || !unitKeys.length) {
    return deductions;
  }

  const tiers = [
    ["Philippines", "India"],
    ["United States", "Canada", "Israel"]
  ];

  // Allocate within one tier, proportionally to available capacity
  function allocateTier(countryList) {
    if (remaining <= 0) return;

    const active = unitKeys.filter(k => {
      const country = k.split("|")[0];
      return countryList.includes(country) && origCap[k] > 0;
    });
    if (!active.length) return;

    let capSum = 0;
    active.forEach(k => { capSum += origCap[k]; });
    if (capSum <= 0) return;

    const tierNeed = Math.min(remaining, capSum);

    // First pass: proportional floor allocation
    const provisional = {};
    let allocated = 0;

    active.forEach(k => {
      const cap = origCap[k];
      const shareFloat = tierNeed * (cap / capSum); // uses JS float, but we'll correct
      let alloc = Math.floor(shareFloat);
      if (alloc > cap) alloc = cap;
      provisional[k] = alloc;
      allocated += alloc;
    });

    let leftover = tierNeed - allocated;

    // Second pass: distribute leftover units by largest fractional remainder
    if (leftover > 0) {
      const ranked = active
        .map(k => {
          const cap = origCap[k];
          const shareFloat = tierNeed * (cap / capSum);
          return {
            k,
            rem: shareFloat - provisional[k],
            cap
          };
        })
        .sort((a, b) => b.rem - a.rem); // descending remainder

      for (const { k, cap } of ranked) {
        if (leftover <= 0) break;
        const current = provisional[k];
        if (current < cap) {
          provisional[k]++;
          leftover--;
        }
      }
    }

    // Apply results
    active.forEach(k => {
      const alloc = provisional[k];
      if (alloc > 0) {
        deductions[k] += alloc;
        origCap[k]    -= alloc;
        remaining     -= alloc;
      }
    });
  }

  // Apply tiers in order
  tiers.forEach(allocateTier);

  // Final integer correction to fix small rounding errors only
  let allocatedTotal = Object.values(deductions).reduce((s, v) => s + v, 0);
  let unitError = adjUnits - allocatedTotal;

  // We try to nudge allocations within capacity limits.
  // If adjUnits > total capacity, this loop exits quickly (no room to adjust).
  while (unitError !== 0) {
    let any = false;

    for (const k of unitKeys) {
      const cap = availableUnits[k] || 0;
      if (unitError > 0 && deductions[k] < cap) {
        deductions[k]++;
        unitError--;
        any = true;
      } else if (unitError < 0 && deductions[k] > 0) {
        deductions[k]--;
        unitError++;
        any = true;
      }
      if (unitError === 0) break;
    }

    if (!any) break; // no more room to correct
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
