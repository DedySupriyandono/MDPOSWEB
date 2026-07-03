// QR / SN normalize helper — dipakai semua view scan (Picking, Receipt,
// StockOpname, SalesReturns, CustomerReturns, StockAdjustment, Expenditure).
//
// 2 utility function:
//   window.qrStripWhitespace(raw)   → hapus semua spasi/newline dari SN.
//   window.qrExtract(raw)           → async; strip whitespace + kalau URL,
//                                     call server extract SN "cantik" (nomor
//                                     HP Kartu Perdana atau SN voucher). Kalau
//                                     bukan URL / no match → return raw stripped.
//
// Endpoint server: POST /Picking/ExtractSn { qr } → { ok, sn }.
// Reuse endpoint yg sama biar ga bikin duplikat per controller.
(function () {
    function stripWhitespace(raw) {
        return String(raw == null ? '' : raw).replace(/\s+/g, '');
    }

    async function qrExtract(raw) {
        var s = stripWhitespace(raw);
        if (!s) return '';
        // Kalau bukan URL, skip round-trip — server pun akan return as-is.
        if (s.indexOf('://') < 0) return s;
        try {
            var res = await fetch('/Picking/ExtractSn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr: s }),
            });
            var j = await res.json();
            return (j && j.ok && j.sn) ? String(j.sn) : s;
        } catch (e) {
            return s;
        }
    }

    window.qrStripWhitespace = stripWhitespace;
    window.qrExtract         = qrExtract;
})();
