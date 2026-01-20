// --- Project Code -> Project Name mapping (source: your table) ---
const PROJECT_CODE_MAP = {
  MUPDR: "Dextera-Ego Robotics Data Collection",
  MUPSL: "Superintelligence Lab line of business (LOB)",
  MUPMS: "MASE",
  MUPPD: "Product Data Operations (Gen AI)",
  MUPDA: "Data Annotation",
  MUPAI: "Product Data Operations (Gen AI)",
};

document.getElementById("fileDollar").addEventListener("change", function (event) {
  handleDollarFile(event);
});

function handleDollarFile(event) {
  const file = event.target.files[0];

  // Read and validate transmission date (more reliable than checking transmitDate string)
  const rawDate = document.getElementById("transmitDate").value;
  if (!rawDate) {
    alert("Please select a transmission date.");
    return;
  }

  const dateObj = new Date(rawDate);
  if (isNaN(dateObj.getTime())) {
    alert("Please select a valid transmission date.");
    return;
  }

  const options = { year: "numeric", month: "long", day: "numeric" };
  const transmitDate = dateObj.toLocaleDateString("en-US", options);

  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      processDollarFile(jsonData, transmitDate);
    };
    reader.readAsArrayBuffer(file);
  }
}

function processDollarFile(data, transmitDate) {
  const zip = new JSZip();
  const folder = zip.folder("Dollar Files");
  const grouped = {};

  data.forEach((row) => {
    if (!grouped[row.Filename]) {
      grouped[row.Filename] = [];
    }
    grouped[row.Filename].push(row);
  });

  Object.keys(grouped).forEach((filename) => {
    const group = grouped[filename];

    const projectCode = group[0]["PROJECT CODE"];
    const projectName = PROJECT_CODE_MAP[projectCode] || "UNKNOWN PROJECT";

    const specialTypeValue = filename
      .split("_")
      .slice(3)
      .join("_")
      .split(".")[0];

    let output =
      `CLIENT NAME           : MUSTANG PLATFORMS, INC.\n` +
      `PROJECT CODE          : ${projectCode}\n` +
      `PROJECT NAME          : ${projectName}\n` +
      `PRODUCTION CONTACT    : Nette Lagonilla\n` +
      `DATE TRANSMITTED      : ${transmitDate}\n\n` +
      `TRANSMISSION FILENAME : ${filename}\n` +
      `SPECIAL INVOICING TYPE: PO Number\n` +
      `SPECIAL TYPE VALUE    : ${specialTypeValue}\n\n`;

    group.forEach((row) => {
      const qtyRaw = row["Total Billable Quantity"];
      const qtyNum = parseFloat(qtyRaw);
      const qtyFormatted = Number.isFinite(qtyNum) ? qtyNum.toFixed(6) : "0.000000";

      output +=
        `FACILITY             : ${row.Facility}\n` +
        `BILLING ITEM NUMBER  : ${row["Billing Item Number"]}\n` +
        `TOTAL BILLABLE QUANTITY : ${qtyFormatted}\n\n`;
    });

    output += "=".repeat(60) + "\n";

    folder.file(`${filename}.txt`, output);
  });

  zip.generateAsync({ type: "blob" }).then((content) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "Dollar_Files.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

