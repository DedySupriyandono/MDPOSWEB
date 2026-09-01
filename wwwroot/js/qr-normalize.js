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
        // Shortcut LAMA `if (s.indexOf('://') < 0) return s;` bikin bug:
        // kategori voucher yg pattern-nya (\d{12})\d{3}$ (extract 12-digit
        // sebelum 3-digit checksum) TIDAK terpanggil kalau user paste raw
        // 15-digit (bukan URL). Client jadi treat "901947202414050" sbg
        // 15-digit → compute range 38 juta → block. Skrg selalu round-trip
        // ke server → SmartExtract coba semua qr_pattern kategori → extract
        // 12-digit yg benar. Latency < 50ms lokal, cuma dipanggil di
        // trigger scan (bukan per-keystroke) — cost dapat diabaikan.
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
