/*
 * MDPOS Export Helper — Universal PDF / Print / Excel generator.
 *
 * Cara pakai (semua view Index):
 *
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
 *   <script src="~/assets/js/mdpos-export.js"></script>
 *   <script>
 *     document.getElementById('btn-pdf').onclick   = () => MdposExport.pdf({ title:'Products', tableSelector:'#product-table' });
 *     document.getElementById('btn-print').onclick = () => MdposExport.print({ title:'Products', tableSelector:'#product-table' });
 *     document.getElementById('btn-excel').onclick = () => MdposExport.excel('/Products/ExportExcel');
 *   </script>
 *
 * Helper otomatis:
 *   - Scrape <thead> + <tbody> dari table di DOM (tidak butuh AJAX ke server).
 *   - Skip kolom yang punya class `.no-export` atau data-no-export="true" (mis. Action, Checkbox).
 *   - Untuk PDF: pakai jsPDF landscape A4 + autotable.
 *   - Untuk Print: buka popup HTML print-friendly + auto window.print().
 *   - Untuk Excel: langsung window.location.href (server-side ExportExcel).
 */
(function (global) {
    'use strict';

    // Ambil header + rows dari table DOM. Skip kolom Action/Checkbox.
    function scrapeTable(selector) {
        const table = document.querySelector(selector);
        if (!table) {
            console.warn('[MdposExport] Table tidak ditemukan:', selector);
            return { headers: [], rows: [], skipIdx: new Set() };
        }

        // Deteksi kolom yg harus skip — via class `.no-export` di <th> atau
        // data-no-export="true" atau text-nya "Action" / "" (kosong).
        const skipIdx = new Set();
        const thList = table.querySelectorAll('thead th, thead td');
        const headers = [];
        thList.forEach((th, i) => {
            const skip =
                th.classList.contains('no-export') ||
                th.classList.contains('no-sort') ||
                th.dataset.noExport === 'true' ||
                th.querySelector('input[type="checkbox"]');
            const label = th.innerText.trim();
            if (skip || label === '' || label.toLowerCase() === 'action' || label.toLowerCase() === 'aksi') {
                skipIdx.add(i);
                return;
            }
            headers.push(label);
        });

        const rows = [];
        table.querySelectorAll('tbody tr').forEach(tr => {
            const cells = tr.querySelectorAll('td');
            // Skip empty row (DataTables "no data")
            if (cells.length === 0 || (cells.length === 1 && cells[0].hasAttribute('colspan'))) return;
            const row = [];
            cells.forEach((td, i) => {
                if (skipIdx.has(i)) return;
                // Ambil pure text — strip HTML/icons.
                let text = td.innerText.trim().replace(/\s+/g, ' ');
                row.push(text);
            });
            rows.push(row);
        });

        return { headers, rows, skipIdx };
    }

    const MdposExport = {
        // Download PDF client-side pakai jsPDF + autotable.
        pdf: function (config) {
            const { title, tableSelector, orientation, fileName } = config || {};
            const { headers, rows } = scrapeTable(tableSelector);
            if (headers.length === 0) {
                alert('Tabel kosong / tidak ditemukan');
                return;
            }
            if (!window.jspdf || !window.jspdf.jsPDF) {
                alert('jsPDF library belum ter-load');
                return;
            }
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: orientation || 'landscape', unit: 'mm', format: 'a4' });

            doc.setFontSize(14);
            doc.text(title || 'Report', 14, 14);
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text('Generated: ' + new Date().toLocaleString('id-ID'), 14, 20);
            doc.text('Total Baris: ' + rows.length, 14, 25);
            doc.setTextColor(0);

            doc.autoTable({
                head: [headers],
                body: rows,
                startY: 30,
                styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
                headStyles: { fillColor: [229, 231, 235], textColor: 30, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [250, 250, 250] },
            });

            const fname = fileName ||
                ((title || 'Report').replace(/[^\w-]/g, '_') + '_' +
                 new Date().toISOString().slice(0, 19).replace(/[:\-T]/g, '') + '.pdf');
            doc.save(fname);
        },

        // Buka popup HTML print-friendly + auto window.print()
        print: function (config) {
            const { title, tableSelector } = config || {};
            const { headers, rows } = scrapeTable(tableSelector);
            if (headers.length === 0) {
                alert('Tabel kosong / tidak ditemukan');
                return;
            }

            const escHtml = s => String(s ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            const trs = rows.map(r =>
                '<tr>' + r.map(v => '<td>' + escHtml(v) + '</td>').join('') + '</tr>'
            ).join('');

            const html =
                '<!DOCTYPE html><html><head><title>' + escHtml(title || 'Report') + '</title>' +
                '<style>' +
                '@page { size: A4 landscape; margin: 12mm; }' +
                'body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 0; color: #111; }' +
                'h1 { font-size: 16px; margin: 0 0 4px 0; }' +
                '.meta { font-size: 10px; color: #666; margin-bottom: 8px; }' +
                'table { width: 100%; border-collapse: collapse; }' +
                'th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }' +
                'thead th { background: #e5e7eb; font-weight: 700; }' +
                'tbody tr:nth-child(even) td { background: #fafafa; }' +
                '.toolbar { margin: 8px 0 12px 0; }' +
                '.toolbar button { padding: 6px 14px; margin-right: 8px; border: 1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer; font-size:12px; }' +
                '@media print { .toolbar { display: none; } }' +
                '</style></head><body>' +
                '<div class="toolbar">' +
                '<button onclick="window.print()">🖨 Print / Save as PDF</button>' +
                '<button onclick="window.close()">Close</button>' +
                '</div>' +
                '<h1>' + escHtml(title || 'Report') + '</h1>' +
                '<div class="meta">Generated: ' + new Date().toLocaleString('id-ID') +
                ' &nbsp;|&nbsp; Total Baris: ' + rows.length + '</div>' +
                '<table><thead><tr>' + headers.map(h => '<th>' + escHtml(h) + '</th>').join('') + '</tr></thead>' +
                '<tbody>' + trs + '</tbody></table>' +
                '<script>window.addEventListener("load", function(){ setTimeout(window.print, 300); });<' + '/script>' +
                '</body></html>';

            const w = window.open('', '_blank');
            if (!w) {
                alert('Popup di-block browser. Izinkan popup di setting untuk domain ini.');
                return;
            }
            w.document.write(html);
            w.document.close();
        },

        // Redirect ke server-side ExportExcel URL.
        excel: function (url) {
            if (!url) return;
            window.location.href = url;
        },

        // Convenience: bind semua 3 button (PDF/Excel/Print) sekaligus.
        // Config: { title, tableSelector, excelUrl, pdfBtnId, excelBtnId, printBtnId }
        bindButtons: function (config) {
            const c = config || {};
            const pdfBtn   = document.getElementById(c.pdfBtnId   || 'btn-pdf');
            const excelBtn = document.getElementById(c.excelBtnId || 'btn-excel');
            const printBtn = document.getElementById(c.printBtnId || 'btn-print');
            if (pdfBtn) pdfBtn.addEventListener('click', (e) => {
                e.preventDefault();
                MdposExport.pdf({ title: c.title, tableSelector: c.tableSelector, orientation: c.orientation, fileName: c.pdfFileName });
            });
            if (excelBtn && c.excelUrl) excelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                MdposExport.excel(c.excelUrl);
            });
            if (printBtn) printBtn.addEventListener('click', (e) => {
                e.preventDefault();
                MdposExport.print({ title: c.title, tableSelector: c.tableSelector });
            });
        }
    };

    global.MdposExport = MdposExport;
})(window);
