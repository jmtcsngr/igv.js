/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Broad Institute
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var igv = (function (igv) {

    igv.FeatureTrack = function (config) {

        igv.configTrack(this, config);

        this.displayMode = config.displayMode || "COLLAPSED";    // COLLAPSED | EXPANDED | SQUISHED

        this.collapsedHeight = config.collapsedHeight || this.height;
        this.expandedRowHeight = config.expandedRowHeight || 30;
        this.squishedRowHeight = config.squishedRowHeight || 15;

        this.maxHeight = config.maxHeight || Math.max(500, this.height);

        this.labelThreshold = 1000000;

        this.featureSource = new igv.FeatureSource(this.config);

        if (this.type === "vcf") {
            this.render = renderVariant;
        }
        else {
            this.render = renderFeature;
        }
    };

    igv.FeatureTrack.prototype.getFeatures = function (chr, bpStart, bpEnd, continuation, task) {

        // Don't try to draw alignments for windows > the visibility window
        if (this.visibilityWindow && igv.browser.trackWidthBP() > this.visibilityWindow) {
            continuation({exceedsVisibilityWindow: true});
        }
        else {
            this.featureSource.getFeatures(chr, bpStart, bpEnd, continuation, task)
        }
    };

    igv.FeatureTrack.prototype.computePixelHeight = function (features) {

        if (this.displayMode === "COLLAPSED") {
            return this.collapsedHeight;
        }
        else {
            var maxRow = 0;
            features.forEach(function (feature) {

                if (feature.row && feature.row > maxRow) maxRow = feature.row;

            });

            return  (maxRow + 1) * (this.displayMode === "SQUISHED" ? this.squishedRowHeight : this.expandedRowHeight);

        }

    };

    igv.FeatureTrack.prototype.draw = function (options) {

        var track = this,
            featureList = options.features,
            ctx = options.context,
            bpPerPixel = options.bpPerPixel,
            bpStart = options.bpStart,
            pixelWidth = options.pixelWidth,
            pixelHeight = options.pixelHeight,
            bpEnd = bpStart + pixelWidth * bpPerPixel + 1,
            zoomInNoticeFontStyle = { font: '16px PT Sans', fillStyle: "rgba(64, 64, 64, 1)", strokeStyle: "rgba(64, 64, 64, 1)" };


        igv.Canvas.fillRect.call(ctx, 0, 0, pixelWidth, pixelHeight, {'fillStyle': "rgb(255, 255, 255)"});

        if (options.features.exceedsVisibilityWindow) {

            for (var x = 200; x < pixelWidth; x += 400) {
                igv.Canvas.fillText.call(ctx, "Zoom in to see features", x, 20, zoomInNoticeFontStyle);
            }
            return;
        }

        if (featureList) {

            igv.Canvas.setProperties.call(ctx,  { fillStyle: track.color, strokeStyle: track.color } );

            for (var gene, i = 0, len = featureList.length; i < len; i++) {
                gene = featureList[i];
                if (gene.end < bpStart) continue;
                if (gene.start > bpEnd) break;
                track.render.call(this, gene, bpStart, bpPerPixel, pixelHeight, ctx);
            }
        }
        else {
            console.log("No feature list");
        }

    };

    /**
     * Return "popup data" for feature @ genomic location.  Data is an array of key-value pairs
     */
    igv.FeatureTrack.prototype.popupData = function (genomicLocation, xOffset, yOffset) {

        // We use the featureCache property rather than method to avoid async load.  If the
        // feature is not already loaded this won't work,  but the user wouldn't be mousing over it either.
        if (this.featureSource.featureCache) {

            var chr = igv.browser.referenceFrame.chr,  // TODO -- this should be passed in
                tolerance = igv.browser.referenceFrame.bpPerPixel,  // We need some tolerance around genomicLocation, start with +/- 1 pixel
                featureList = this.featureSource.featureCache.queryFeatures(chr, genomicLocation - tolerance, genomicLocation + tolerance),
                row;

            if (this.displayMode != "COLLAPSED") {
                row = (Math.floor)(this.displayMode === "SQUISHED" ? yOffset / this.squishedRowHeight : yOffset / this.expandedRowHeight);
            }

            if (featureList && featureList.length > 0) {


                var popupData = [];
                featureList.forEach(function (feature) {
                    if (feature.popupData &&
                        feature.end >= genomicLocation - tolerance &&
                        feature.start <= genomicLocation + tolerance) {

                        if (row === undefined || feature.row === undefined || row === feature.row) {
                            var featureData = feature.popupData(genomicLocation);
                            if (featureData) {
                                if (popupData.length > 0) {
                                    popupData.push("<HR>");
                                }
                                Array.prototype.push.apply(popupData, featureData);
                            }
                        }
                    }
                });

                return popupData;
            }

        }

        return null;
    };

    igv.FeatureTrack.prototype.popupMenuItems = function (popover) {

        var myself = this,
            menuItems = [],
            lut = { "EXPANDED": "Expand track hgt", "COLLAPSED": "Collapse track hgt", "SQUISHED": "Squish track hgt" },
            checkMark     = '<i class="fa fa-check fa-check-shim"></i>',
            checkMarkNone = '<i class="fa fa-check fa-check-shim fa-check-hidden"></i>',
            trackMenuItem = '<div class=\"igv-track-menu-item\">',
            trackMenuItemFirst = '<div class=\"igv-track-menu-item igv-track-menu-border-top\">';

        menuItems.push(igv.colorPickerMenuItem(popover, this.trackView, "Set feature color", this.color));

        [ "EXPANDED", "SQUISHED", "COLLAPSED" ].forEach(function(displayMode, index){

            var chosen,
                str;

            chosen = (0 === index) ? trackMenuItemFirst : trackMenuItem;
            str = (displayMode === myself.displayMode) ? chosen + checkMark + lut[ displayMode ] + '</div>' : chosen + checkMarkNone + lut[ displayMode ] + '</div>';

            menuItems.push({
                object: $(str),
                click: function () {
                    popover.hide();
                    myself.displayMode = displayMode;
                    myself.trackView.update();
                }
            });

        });

        return menuItems;

    };

    /**
     *
     * @param feature
     * @param bpStart  genomic location of the left edge of the current canvas
     * @param xScale  scale in base-pairs per pixel
     * @param pixelHeight  pixel height of the current canvas
     * @param ctx  the canvas 2d context
     */

    function renderFeature(feature, bpStart, xScale, pixelHeight, ctx) {

        var px,
            px1,
            pw,
            exonCount,
            cy,
            direction,
            exon,
            ePx,
            ePx1,
            ePw,
            py = 5,
            step = 8,
            h = 10,
            transform,
            fontStyle;

        px = Math.round((feature.start - bpStart) / xScale);
        px1 = Math.round((feature.end - bpStart) / xScale);
        pw = px1 - px;
        if (pw < 3) {
            pw = 3;
            px -= 1;
        }

        if (this.displayMode === "SQUISHED" && feature.row != undefined) {
            py = this.squishedRowHeight * feature.row;
        }
        else if (this.displayMode === "EXPANDED" && feature.row != undefined) {
            py = this.expandedRowHeight * feature.row;
        }

        exonCount = feature.exons ? feature.exons.length : 0;

        if (exonCount == 0) {
           ctx.fillRect(px, py, pw, h);

        }
        else {
            cy = py + 5;
            igv.Canvas.strokeLine.call(ctx, px, cy, px1, cy);
            direction = feature.strand == '+' ? 1 : -1;
            for (var x = px + step / 2; x < px1; x += step) {
                igv.Canvas.strokeLine.call(ctx, x - direction * 2, cy - 2, x, cy);
                igv.Canvas.strokeLine.call(ctx, x - direction * 2, cy + 2, x, cy);
            }
            for (var e = 0; e < exonCount; e++) {
                exon = feature.exons[e];
                ePx = Math.round((exon.start - bpStart) / xScale);
                ePx1 = Math.round((exon.end - bpStart) / xScale);
                ePw = Math.max(1, ePx1 - ePx);
                ctx.fillRect(ePx, py, ePw, h);

            }
        }

        fontStyle = { font: '10px PT Sans', fillStyle: this.color, strokeStyle: this.color };

        var geneColor;
        if (igv.browser.selection) {
            geneColor = igv.browser.selection.colorForGene(feature.name);
        } // TODO -- for gtex, figure out a better way to do this

        if (((px1 - px) > 20 || geneColor) && this.displayMode != "SQUISHED") {

            var geneFontStyle;
            if (geneColor) {
                geneFontStyle = { font: '10px PT Sans', fillStyle: geneColor, strokeStyle: geneColor }
            }
            else {
                geneFontStyle = fontStyle;
            }


            if (this.displayMode === "COLLAPSED" && this.labelDisplayMode === "SLANT") {
                transform = {rotate: {angle: 45}};
            }

            var labelY = transform ? py + 20 : py + 25;
            igv.Canvas.fillText.call(ctx, feature.name, px + ((px1 - px) / 2), labelY, geneFontStyle, transform);
        }
    }

    /**
     *
     * @param variant
     * @param bpStart  genomic location of the left edge of the current canvas
     * @param xScale  scale in base-pairs per pixel
     * @param pixelHeight  pixel height of the current canvas
     * @param ctx  the canvas 2d context
     */
    function renderVariant(variant, bpStart, xScale, pixelHeight, ctx) {

        var px, px1, pw,
            py = 20,
            h = 10;


        px = Math.round((variant.start - bpStart) / xScale);
        px1 = Math.round((variant.end - bpStart) / xScale);
        pw = Math.max(1, px1 - px);
        if (pw < 3) {
            pw = 3;
            px -= 1;
        }

        ctx.fillRect.call(px, py, pw, h);


    }

    return igv;

})
(igv || {});