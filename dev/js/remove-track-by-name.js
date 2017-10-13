var rtbn = (function (rtbn) {

    rtbn.init = function ($container) {

        $(document).ready(function () {
            var config,
                browser;

            config = {
                minimumBases: 6,
                showIdeogram: true,
                showKaryo: false,
                showCenterGuide: false,
                showCursorTrackingGuide: false,
                showRuler: true,
//            locus: '10:89,461,189-89,890,540',
           locus: [ 'egfr',  'myc',  'pten' ],
//            locus: [ 'egfr', 'pten' ],
//                 locus: '1',
//            locus: '1:120,777,648-128,566,728',
                reference: {
                    id: "hg19",
                    fastaURL: "https://s3.amazonaws.com/igv.broadinstitute.org/genomes/seq/1kg_v37/human_g1k_v37_decoy.fasta",
                    cytobandURL: "https://s3.amazonaws.com/igv.broadinstitute.org/genomes/seq/b37/b37_cytoband.txt"
                },
                flanking: 1000,
                apiKey: 'AIzaSyDUUAUFpQEN4mumeMNIRWXSiTh5cPtUAD0',
                palette: ["#00A0B0", "#6A4A3C", "#CC333F", "#EB6841"],
                tracks:
                    [
                        {
                            url: 'https://data.broadinstitute.org/igvdata/encode/hg19/broadHistone/wgEncodeBroadHistoneGm12878H3k4me2StdSig.wig.tdf',
                            name: 'GM12878H3k4m3 (tdf)'
                        },
                        {
                            name: "Genes",
                            searchable: false,
                            type: "annotation",
                            format: "gtf",
                            sourceType: "file",
                            url: "https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.annotation.sorted.gtf.gz",
                            indexURL: "https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.annotation.sorted.gtf.gz.tbi",
                            visibilityWindow: 10000000,
                            order: Number.MAX_VALUE,
                            displayMode: "EXPANDED"
                        }
                    ]
            };

            browser = igv.createBrowser($container.get(0), config);

        });

        $('#remove-track-by-name').on('click', function (e) {

            var name,
                names;

            names = getAllTrackNames();
            name = 'GM12878H3k4m3 (tdf)';
            if (_.contains(names, name)) {
                igv.browser.removeTrackByName('GM12878H3k4m3 (tdf)');
            }
        });

        function getAllTrackNames () {
            return _.map(igv.browser.trackViews, function (trackView) {
                return trackView.track.name;
            })
        }
    };

    return rtbn;

})(rtbn || {});