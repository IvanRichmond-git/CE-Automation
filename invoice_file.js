document.getElementById('fileInvoice').addEventListener('change', function(event) {
    handleInvoiceFile(event);
});

function handleInvoiceFile(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet);
            processInvoiceFile(jsonData);
        };
        reader.readAsArrayBuffer(file);
    }
}

function processInvoiceFile(data) {
    const workweekColumns = Object.keys(data[0]).filter(col => col.startsWith("WW"));
    const numericColumns = [...workweekColumns, 'Rate/hour'];
    data.forEach(row => {
        numericColumns.forEach(col => {
            row[col] = parseFloat(row[col]) || 0;
        });
        row['Total Hours'] = workweekColumns.reduce((sum, col) => sum + row[col], 0);
        row['Invoice Amount'] = row['Total Hours'] * row['Rate/hour'];
    });

    const outputRows = [];
    const groupedData = {};

    data.forEach(row => {
        const staffingKey = `${row.Site}|${row['Product Pillar']}|${row['Market Supported']}|${row.Location}|${row['PO#']}|${row['Staffing Level']}|${row.Language}`;
        if (!groupedData[staffingKey]) groupedData[staffingKey] = [];
        groupedData[staffingKey].push(row);
    });

    Object.keys(groupedData).forEach(staffingKey => {
        const [site, productPillar, marketSupported, location, po, staffingLevel, language] = staffingKey.split('|');
        outputRows.push(["Site:", site]);
        outputRows.push(["Product Pillar:", productPillar]);
        outputRows.push(["Market Supported:", marketSupported]);
        outputRows.push(["Location:", location]);
        outputRows.push(["PO#:", po]);
        outputRows.push(["Invoice#"]);
        outputRows.push([]);
        
        outputRows.push(["Staffing Level", "Language", "Level", "Role", "Rate/hour", ...workweekColumns, "Total Hours", "Invoice Amount"]);
        let totalHours = 0, totalInvoice = 0;
        let totals = workweekColumns.map(() => 0);

        groupedData[staffingKey].forEach(row => {
            const weekValues = workweekColumns.map(col => row[col] || 0);
            totals = totals.map((sum, index) => sum + weekValues[index]);
            totalHours += row['Total Hours'];
            totalInvoice += row['Invoice Amount'];

            outputRows.push([
                row['Staffing Level'], row.Language, row.Level, row.Role, row['Rate/hour'],
                ...weekValues,
                row['Total Hours'], row['Invoice Amount']
            ]);
        });
        outputRows.push(["Total", "", "", "", "", ...totals, totalHours, totalInvoice]);
        outputRows.push([]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(outputRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice Output");
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    downloadFile(new Blob([excelBuffer], { type: 'application/octet-stream' }), "MXX Invoice.xlsx");
}

function downloadFile(content, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
