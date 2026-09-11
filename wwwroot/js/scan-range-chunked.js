/**
 * ScanRangeChunked — helper reusable untuk scan range SN dengan:
 *   - Client-side SN extraction (via categories.qr_pattern, dari server)
 *   - Auto-chunking (default 5000 SN per HTTP call)
 *   - Progress bar modal (SweetAlert2 + Bootstrap)
 *   - Cancel (AbortController)
 *   - Auto-stop kalau server signal target tercapai
 *
 * Dipakai di: SalesOutbound, StockTransfer, ClusterTransfer, SfStockAudit,
 *   StockAdjustment, StockOpname, SalesReturn, CustomerReturn, SalesDeposit.
 *
 * Usage:
 *   ScanRangeChunked.run({
 *     endpoint: '/StockTransfer/ScanRange',   // POST target
 *     rawStart: '<URL or SN>',
 *     rawEnd:   '<URL or SN>',
 *     buildPayload: function (startSn, endSn) {
 *       return { HeaderUid: 'xxx', StartSn: startSn, EndSn: endSn };
 *     },
 *     parseResp: function (res) {
 *       // Map server response → { added, dupCount, invalidCount, wrongProductCount,
 *       //                          notAvailableCount, overLimitCount, pickedCount, qtyTarget }
 *       // Field yg tidak ada → 0.
 *       return {
 *         added:            res.added || res.inserted || 0,
 *         dupCount:         res.dupCount || 0,
 *         invalidCount:     res.invalidCount || 0,
 *         wrongProductCount:res.wrongProductCount || 0,
 *         notAvailableCount:res.notAvailableCount || 0,
 *         overLimitCount:   res.overLimitCount || 0,
 *         pickedCount:      res.pickedCount || 0,
 *         qtyTarget:        res.qtyTarget || 0,
 *       };
 *     },
 *     chunkSize:  5000,                     // opsional, default 5000
 *     qtyTarget:  100000,                   // opsional — utk preview confirm
 *     alreadyPicked: 25000,                 // opsional — utk preview confirm
 *     onDone: function (summary) {          // opsional — dipanggil setelah selesai
 *       reloadTable();
 *     },
 *   });
 */
(function () {
    var _patternsCache = null;

    function loadPatterns() {
        if (_patternsCache !== null) return Promise.resolve(_patternsCache);
        return new Promise(function (resolve) {
            $.get('/Home/GetQrPatterns', function (r) {
                _patternsCache = (r && r.status && Array.isArray(r.patterns)) ? r.patterns : [];
                resolve(_patternsCache);
            }).fail(function () {
                _patternsCache = [];
                resolve(_patternsCache);
            });
        });
    }

    // Extract SN via qr_pattern kategori. Mirror QrSnExtractor.SmartExtractAsync.
    // Try each pattern in order; first that matches → return group(1) or full match.
    // Kalau tidak ada yg match → return raw as-is (fallback).
    function extractSn(raw, patterns) {
        if (!raw) return '';
        var s = String(raw).replace(/\s+/g, '');
        if (!s) return '';
        if (!patterns || patterns.length === 0) return s;
        for (var i = 0; i < patterns.length; i++) {
            try {
                var re = new RegExp(patterns[i], 'i');
                var m  = s.match(re);
                if (m) return (m[1] !== undefined ? m[1] : m[0]).trim();
            } catch (e) { /* skip broken pattern */ }
        }
        return s;
    }

    async function run(opts) {
        opts = opts || {};
        var endpoint     = opts.endpoint;
        var rawStart     = opts.rawStart;
        var rawEnd       = opts.rawEnd;
        var buildPayload = opts.buildPayload;
        var parseResp    = opts.parseResp || function (r) { return r || {}; };
        var chunkSize    = opts.chunkSize    || 5000;
        var qtyTarget    = opts.qtyTarget    || 0;
        var alreadyPicked= opts.alreadyPicked|| 0;
        var onDone       = opts.onDone;

        if (!endpoint || !buildPayload) {
            console.error('ScanRangeChunked: endpoint & buildPayload wajib.');
            return;
        }
        if (!rawStart || !rawEnd) {
            Swal.fire({ icon:'warning', title:'Range kosong', text:'SN Awal & Akhir wajib.' });
            return;
        }

        var patterns = await loadPatterns();
        var startSn  = extractSn(rawStart, patterns);
        var endSn    = extractSn(rawEnd,   patterns);

        // Parse — common prefix + numeric tail sama panjang (pada SN, bukan URL)
        var commonLen = 0;
        while (commonLen < startSn.length && commonLen < endSn.length
            && startSn[commonLen] === endSn[commonLen]) commonLen++;
        var prefix     = startSn.substring(0, commonLen);
        var numFromStr = startSn.substring(commonLen);
        var numToStr   = endSn.substring(commonLen);
        if (!/^\d+$/.test(numFromStr) || !/^\d+$/.test(numToStr)) {
            Swal.fire({ icon:'warning', title:'Format SN salah', text:'Tail SN harus angka murni & prefix sama.' }); return;
        }
        if (numFromStr.length !== numToStr.length) {
            Swal.fire({ icon:'warning', title:'Format SN salah', text:'SN awal & akhir harus sama panjang.' }); return;
        }
        var padLen = numFromStr.length;
        var nFrom  = parseInt(numFromStr, 10);
        var nTo    = parseInt(numToStr,   10);
        if (isNaN(nFrom) || isNaN(nTo) || nTo < nFrom) {
            Swal.fire({ icon:'warning', title:'Range invalid', text:'Akhir < awal atau overflow.' }); return;
        }
        var totalRange = nTo - nFrom + 1;
        var slotLeft   = Math.max(0, qtyTarget - alreadyPicked);

        // Preview confirm — kalau range >> slot tersisa
        if (slotLeft > 0 && totalRange > slotLeft * 2) {
            var proceed = await Swal.fire({
                icon: 'warning', title: 'Range lebih besar dari yg dibutuhkan',
                html: 'Range terdeteksi: <b>' + totalRange.toLocaleString('id-ID') + '</b> SN<br>' +
                      'Slot tersisa: <b>' + slotLeft.toLocaleString('id-ID') + '</b>' +
                      '<br><br>SN Awal: <code>' + startSn + '</code>' +
                      '<br>SN Akhir: <code>' + endSn   + '</code>' +
                      '<br><br>Sistem akan otomatis stop saat slot penuh. Lanjut?',
                showCancelButton: true, confirmButtonText: 'Lanjut', cancelButtonText: 'Batal',
            });
            if (!proceed.isConfirmed) return;
        }

        var cancelled = false, reachedTarget = false, currentAbort = null;

        Swal.fire({
            title: 'Memproses ' + totalRange.toLocaleString('id-ID') + ' SN',
            html: '<div class="progress mb-2" style="height:22px;">' +
                  '  <div id="scanrc-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-primary" ' +
                  '       role="progressbar" style="width:0%">0%</div>' +
                  '</div>' +
                  '<div class="text-muted small text-start" id="scanrc-text">Mempersiapkan…</div>',
            showCancelButton: true, cancelButtonText: 'Batalkan',
            showConfirmButton: false, allowOutsideClick: false, allowEscapeKey: false,
        }).then(function (r) {
            if (r.dismiss === Swal.DismissReason.cancel) {
                cancelled = true;
                if (currentAbort) currentAbort.abort();
            }
        });

        var totalAdded = 0, totalDup = 0, totalInvalid = 0,
            totalWrong = 0, totalNA = 0, totalOver = 0;
        var errors = [];

        for (var startN = nFrom; startN <= nTo; startN += chunkSize) {
            if (cancelled || reachedTarget) break;
            var endN = Math.min(startN + chunkSize - 1, nTo);
            var chunkStart = prefix + String(startN).padStart(padLen, '0');
            var chunkEnd   = prefix + String(endN)  .padStart(padLen, '0');

            currentAbort = new AbortController();
            try {
                var payload = buildPayload(chunkStart, chunkEnd);
                var fd = new FormData();
                Object.keys(payload).forEach(function (k) { fd.append(k, payload[k]); });
                var resp = await fetch(endpoint, { method:'POST', body: fd, signal: currentAbort.signal });
                var res  = await resp.json();
                if (res && res.status !== false && res.success !== false) {
                    var parsed = parseResp(res);
                    totalAdded   += (parsed.added             || 0);
                    totalDup     += (parsed.dupCount          || 0);
                    totalInvalid += (parsed.invalidCount      || 0);
                    totalWrong   += (parsed.wrongProductCount || 0);
                    totalNA      += (parsed.notAvailableCount || 0);
                    totalOver    += (parsed.overLimitCount    || 0);
                    if (parsed.qtyTarget && parsed.pickedCount >= parsed.qtyTarget) reachedTarget = true;
                } else {
                    var msg = (res && res.message) || 'Unknown';
                    errors.push({ range: chunkStart + '..' + chunkEnd, msg: msg });
                    if (msg.indexOf('mencapai target') >= 0) reachedTarget = true;
                }
            } catch (e) {
                if (e.name === 'AbortError') break;
                errors.push({ range: chunkStart + '..' + chunkEnd, msg: e.message });
            }

            var done = endN - nFrom + 1;
            var pct  = Math.round((done / totalRange) * 100);
            var $bar = $('#scanrc-bar');
            if ($bar.length) {
                $bar.css('width', pct + '%').text(pct + '%');
                $('#scanrc-text').html(
                    done.toLocaleString('id-ID') + ' / ' + totalRange.toLocaleString('id-ID') + ' SN diproses' +
                    '<br>Berhasil: <b class="text-success">' + totalAdded.toLocaleString('id-ID') + '</b>' +
                    ' · Skip: ' + (totalDup + totalInvalid + totalWrong + totalNA + totalOver).toLocaleString('id-ID') +
                    (errors.length ? ' · <span class="text-danger">Error: ' + errors.length + '</span>' : '')
                );
            }
        }

        Swal.close();

        var skipTotal = totalDup + totalInvalid + totalWrong + totalNA + totalOver;
        var summary =
            'Berhasil dipick: <b class="text-success">' + totalAdded.toLocaleString('id-ID') + '</b> SN<br>' +
            'Skip (dup/invalid/wrong-product/not-avail): <b>' + skipTotal.toLocaleString('id-ID') + '</b>' +
            (totalDup     ? '<br><small>· Duplikat: '        + totalDup.toLocaleString('id-ID')     + '</small>' : '') +
            (totalInvalid ? '<br><small>· Invalid format: '  + totalInvalid.toLocaleString('id-ID') + '</small>' : '') +
            (totalWrong   ? '<br><small>· Wrong product: '   + totalWrong.toLocaleString('id-ID')   + '</small>' : '') +
            (totalNA      ? '<br><small>· Not available: '   + totalNA.toLocaleString('id-ID')      + '</small>' : '') +
            (totalOver    ? '<br><small>· Over qty target: ' + totalOver.toLocaleString('id-ID')    + '</small>' : '');
        if (cancelled)     summary = '<b class="text-warning">Dibatalkan.</b><br>' + summary;
        if (reachedTarget) summary = '<b class="text-success">Target tercapai — sisa range di-skip.</b><br>' + summary;
        if (errors.length) {
            summary += '<br><span class="text-danger">Chunk gagal: ' + errors.length + ' (cek console)</span>';
            console.error('ScanRangeChunked errors:', errors);
        }

        await Swal.fire({
            icon:  cancelled ? 'info' : (errors.length && !reachedTarget ? 'warning' : 'success'),
            title: cancelled ? 'Dibatalkan' : (errors.length && !reachedTarget ? 'Selesai dengan error' : 'Selesai'),
            html:  summary,
        });

        var finalSummary = {
            added: totalAdded, dupCount: totalDup, invalidCount: totalInvalid,
            wrongProductCount: totalWrong, notAvailableCount: totalNA, overLimitCount: totalOver,
            errors: errors, cancelled: cancelled, reachedTarget: reachedTarget,
        };
        if (typeof onDone === 'function') onDone(finalSummary);
        return finalSummary;
    }

    window.ScanRangeChunked = { run: run, extractSn: extractSn, loadPatterns: loadPatterns };
})();
