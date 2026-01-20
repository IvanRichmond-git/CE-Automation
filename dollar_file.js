document.getElementById('fileDollar').addEventListener('change', function(event) {
    handleDollarFile(event);
});

function handleDollarFile(event) {
    const file = event.target.files[0];
    const rawDate = document.getElementById('transmitDate').value;
    const dateObj = new Date(rawDate);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const transmitDate = dateObj.toLocaleDateString('en-US', options);
    if (!transmitDate) {
        alert("Please select a transmission date.");
        return;
    }
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
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

    data.forEach(row => {
        if (!grouped[row.Filename]) {
            grouped[row.Filename] = [];
        }
        grouped[row.Filename].push(row);
    });

    Object.keys(grouped).forEach(filename => {
        const group = grouped[filename];
        const projectCode = group[0]['PROJECT CODE'];
        const specialTypeValue = filename.split('_').slice(3).join('_').split('.')[0];
        let output = `CLIENT NAME           : MUSTANG PLATFORMS, INC.\n` +
                     `PROJECT CODE          : ${projectCode}\n` +
                     `PROJECT NAME          : Product Data Operations (Gen AI)\n` +
                     `CONTACT PERSON (CLIENT): Sam [samaraw@meta.com] and Emily [emilyfrancia@meta.com]\n` +
                     `PRODUCTION CONTACT    : Nette Lagonilla\n` +
                     `DATE TRANSMITTED      : ${transmitDate}\n\n` +
                     `TRANSMISSION FILENAME : ${filename}\n` +
                     `SPECIAL INVOICING TYPE: PO Number\n` +
                     `SPECIAL TYPE VALUE    : ${specialTypeValue}\n\n`;

        group.forEach(row => {
            output += `FACILITY             : ${row.Facility}\n` +
                      `BILLING ITEM NUMBER  : ${row['Billing Item Number']}\n` +
                      `TOTAL BILLABLE QUANTITY : ${parseFloat(row['Total Billable Quantity']).toFixed(6)}\n\n`;
        });
        output += "=".repeat(60) + "\n";

        folder.file(`${filename}.txt`, output);
    });

    zip.generateAsync({ type: "blob" }).then(content => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = "Dollar_Files.zip";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}


