/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 The Regents of the University of California
 * Author: Jim Robinson
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

    var SEQ_DECODER = ['=', 'A', 'C', 'x', 'G', 'x', 'x', 'x', 'T', 'x', 'x', 'x', 'x', 'x', 'x', 'N'];
    var CIGAR_DECODER = ['M', 'I', 'D', 'N', 'S', 'H', 'P', '=', 'X', '?', '?', '?', '?', '?', '?', '?'];
    var READ_STRAND_FLAG = 0x10;
    var MATE_STRAND_FLAG = 0x20;

    var BAM1_MAGIC_BYTES = new Uint8Array([0x42, 0x41, 0x4d, 0x01]); // BAM\1
    var BAM1_MAGIC_NUMBER = readInt(BAM1_MAGIC_BYTES, 0);

    igv.BamUtils = {

        readHeader: function (url, options, genome) {

            return new Promise(function (fulfill, reject) {

                igv.xhr.loadArrayBuffer(url, options)

                    .then(function (compressedBuffer) {

                        var header, unc, uncba;

                        unc = igv.unbgzf(compressedBuffer);
                        uncba = new Uint8Array(unc);

                        header = igv.BamUtils.decodeBamHeader(uncba, genome);

                        fulfill(header);

                    })
                    .catch(function (error) {
                        reject(error);
                    });

            });
        },

        /**
         *
         * @param ba  bytes to decode as a UInt8Array
         * @param genome  optional igv genome object
         * @returns {{ magicNumer: number, size: number, chrNames: Array, chrToIndex: ({}|*), chrAliasTable: ({}|*) }}
         */
        decodeBamHeader: function (ba, genome) {

            var magic, samHeaderLen, samHeader, alias;

            magic = readInt(ba, 0);
            if (magic !== BAM1_MAGIC_NUMBER) {
                throw new Error('BAM header contains an invalid BAM magic');
            }

            samHeaderLen = readInt(ba, 4);
            samHeader = '';

            for (var i = 0; i < samHeaderLen; ++i) {
                samHeader += String.fromCharCode(ba[i + 8]);
            }

            var nRef = readInt(ba, samHeaderLen + 8);
            var p = samHeaderLen + 12;

            var referenceData = igv.BamUtils.decodeReferenceData(ba, nRef, genome, p);

            return {
                magicNumber:   magic,
                size:          referenceData.p,
                chrNames:      referenceData.chrNames,
                chrToIndex:    referenceData.chrToIndex,
                chrAliasTable: referenceData.chrAliasTable
            };
        },

        /**
         * Decodes data from the BAM2 header
         * @throws if bam2_hdr_flags are set
         * @param  {Uint8Array} ba byte array with data
         * @param  {object} genome
         * @return {{ magicNumer: number, size: number, chrNames: Array, chrToIndex: ({}|*), chrAliasTable: ({}|*) }}
         */
        decodeBam2Header: function(ba, genome) {
            var magic, samHeaderLen, samHeader, alias;
            var bam2headerFlags;

            bam2headerFlags = readUint(ba, 4);

            if (bam2headerFlags !== 0) {
                throw 'unexpected BAM2 header flags decoded as set';
            }

            samHeaderLen = readInt(ba, 8);

            samHeader    = '';
            for (var i = 0; i < samHeaderLen; ++i) {
                samHeader += String.fromCharCode(ba[ i + 12]);
            }

            var nRef = readInt(ba, samHeaderLen + 12);
            var p = samHeaderLen + 16;

            var referenceData = igv.BamUtils.decodeReferenceData(ba, nRef, genome, p);

            return {
                magicNumber:   magic,
                size:          referenceData.p,
                chrNames:      referenceData.chrNames,
                chrToIndex:    referenceData.chrToIndex,
                chrAliasTable: referenceData.chrAliasTable
            };
        },

        /**
         * Decodes reference data from SAM header
         * @param  {Uint8Array} ba byte array with BAM
         * @param  {number} nRef   number of references to decode
         * @param  {object} genome
         * @param  {number} p      [description]
         * @return {{p: number, chrNames: Array, chrToIndex: ({}|*), chrAliasTable: ({}|*)}}
         */
        decodeReferenceData: function(ba, nRef, genome, p) {
            var chrToIndex = {};
            var chrNames = [];
            var chrAliasTable = {};

            for (var i = 0; i < nRef; ++i) {
                var lName = readInt(ba, p);
                var name = '';
                for (var j = 0; j < lName - 1; ++j) {
                    name += String.fromCharCode(ba[p + 4 + j]);
                }
                var lRef = readInt(ba, p + lName + 4);
                //dlog(name + ': ' + lRef);

                chrToIndex[name] = i;
                chrNames[i] = name;

                if (genome) {
                    alias = genome.getChromosomeName(name);
                    chrAliasTable[alias] = name;
                }

                p = p + 8 + lName;
            }

            return {
                p:             p,
                chrToIndex:    chrToIndex,
                chrNames:      chrNames,
                chrAliasTable: chrAliasTable
            };
        },

        bam_tag2cigar: function(ba, block_end, seq_offset, lseq, al, cigarArray) {

            function type2size(x) {
                if (x == 'C' || x == 'c' || x == 'A') return 1;
                else if (x == 'S' || x == 's') return 2;
                else if (x == 'I' || x == 'i' || x == 'f') return 4;
                else return 0;
            }

            // test if the real CIGAR is encoded in a CG:B,I tag
            if (cigarArray.length != 1 || al.start < 0) return false;
            var p = seq_offset + ((lseq + 1) >> 1) + lseq;
            while (p + 4 < block_end) {
                var tag = String.fromCharCode(ba[p]) + String.fromCharCode(ba[p+1]);
                if (tag == 'CG') break;
                var type = String.fromCharCode(ba[p+2]);
                if (type == 'B') { // the binary array type
                    type = String.fromCharCode(ba[p+3]);
                    var size = type2size(type);
                    var len = readInt(ba, p+4);
                    p += 8 + size * len;
                } else if (type == 'Z' || type == 'H') { // 0-terminated string
                    p += 3;
                    while (ba[p++] != 0) {}
                } else { // other atomic types
                    p += 3 + type2size(type);
                }
            }
            if (p >= block_end) return false; // no CG tag
            if (String.fromCharCode(ba[p+2]) != 'B' || String.fromCharCode(ba[p+3]) != 'I') return false; // not of type B,I

            // now we know the real CIGAR length and its offset in the binary array
            var cigar_len = readInt(ba, p+4);
            var cigar_offset = p + 8; // 4 for "CGBI" and 4 for length
            if (cigar_offset + cigar_len * 4 > block_end) return false; // out of bound

            // decode CIGAR
            var cigar = '';
            var lengthOnRef = 0;
            cigarArray.length = 0; // empty the old array
            p = cigar_offset;
            for (var k = 0; k < cigar_len; ++k, p += 4) {
                var cigop = readInt(ba, p);
                var opLen = (cigop >> 4);
                var opLtr = CIGAR_DECODER[cigop & 0xf];
                if (opLtr == 'M' || opLtr == 'EQ' || opLtr == 'X' || opLtr == 'D' || opLtr == 'N' || opLtr == '=')
                    lengthOnRef += opLen;
                cigar = cigar + opLen + opLtr;
                cigarArray.push({len: opLen, ltr: opLtr});
            }

            // update alignment record. We are not updating bin, as apparently it is not used.
            al.cigar = cigar;
            al.lengthOnRef = lengthOnRef;
            return true;
        },

        /**
         *
         * @param ba                 bytes to decode as an UInt8Array
         * @param offset             offset position of ba array to start decoding
         * @param alignmentContainer container to receive the decoded alignments
         * @param min                minimum genomic position
         * @param max                maximum genomic position
         * @param chrIdx             chromosome index
         * @param chrNames            array of chromosome names
         * @param filter             a igv.BamFilter object
         */
        decodeBamRecords: function (ba, offset, alignmentContainer, min, max, chrIdx, chrNames, filter) {

            var blockSize, blockEnd, alignment, blocks, refID, pos, bin_mq_nl, bin, mq, nl, flag_nc, flag, nc, lseq, tlen,
                mateChrIdx, matePos, readName, j, p, lengthOnRef, cigar, c, cigarArray, seq, seqBytes, qualArray;

            while (offset < ba.length) {

                blockSize = readInt(ba, offset);
                blockEnd = offset + blockSize + 4;

                if (blockEnd > ba.length) {
                    return;
                }

                alignment = new igv.BamAlignment();

                refID = readInt(ba, offset + 4);
                pos = readInt(ba, offset + 8);

                if (refID < 0) {
                    continue;   // unmapped read
                }
                else if (refID > chrIdx || pos > max) {
                    return;    // off right edge, we're done
                }
                else if (refID < chrIdx) {
                    continue;   // to left of start, not sure this is possible
                }

                bin_mq_nl = readInt(ba, offset + 12);
                bin = (bin_mq_nl & 0xffff0000) >> 16;
                mq = (bin_mq_nl & 0xff00) >> 8;
                nl = bin_mq_nl & 0xff;

                flag_nc = readInt(ba, offset + 16);
                flag = (flag_nc & 0xffff0000) >> 16;
                nc = flag_nc & 0xffff;

                lseq = readInt(ba, offset + 20);
                mateChrIdx = readInt(ba, offset + 24);
                matePos = readInt(ba, offset + 28);
                tlen = readInt(ba, offset + 32);

                readName = [];
                for (j = 0; j < nl - 1; ++j) {
                    readName.push(String.fromCharCode(ba[offset + 36 + j]));
                }
                readName = readName.join('');

                lengthOnRef = 0;
                cigar = '';
                p = offset + 36 + nl;
                cigarArray = [];
                for (c = 0; c < nc; ++c) {
                    var cigop = readInt(ba, p);
                    var opLen = (cigop >> 4);
                    var opLtr = CIGAR_DECODER[cigop & 0xf];
                    if (opLtr == 'M' || opLtr == 'EQ' || opLtr == 'X' || opLtr == 'D' || opLtr == 'N' || opLtr == '=')
                        lengthOnRef += opLen;
                    cigar = cigar + opLen + opLtr;
                    p += 4;

                    cigarArray.push({len: opLen, ltr: opLtr});
                }

                alignment.chr = chrNames[refID];
                alignment.start = pos;
                alignment.flags = flag;
                alignment.strand = !(flag & READ_STRAND_FLAG);
                alignment.readName = readName;
                alignment.cigar = cigar;
                alignment.lengthOnRef = lengthOnRef;
                alignment.fragmentLength = tlen;
                alignment.mq = mq;

                igv.BamUtils.bam_tag2cigar(ba, blockEnd, p, lseq, alignment, cigarArray);

                if (alignment.start + alignment.lengthOnRef < min) {
                    offset = blockEnd;
                    continue;
                }  // Record out-of-range "to the left", skip to next one


                seq = [];
                seqBytes = (lseq + 1) >> 1;
                for (j = 0; j < seqBytes; ++j) {
                    var sb = ba[p + j];
                    seq.push(SEQ_DECODER[(sb & 0xf0) >> 4]);
                    seq.push(SEQ_DECODER[(sb & 0x0f)]);
                }
                seq = seq.slice(0, lseq).join('');  // seq might have one extra character (if lseq is an odd number)
                p += seqBytes;


                if (lseq === 1 && String.fromCharCode(ba[p + j] + 33) === '*') {
                    // TODO == how to represent this?
                } else {
                    qualArray = [];
                    for (j = 0; j < lseq; ++j) {
                        qualArray.push(ba[p + j]);
                    }
                }
                p += lseq;


                if (mateChrIdx >= 0) {
                    alignment.mate = {
                        chr: chrNames[mateChrIdx],
                        position: matePos,
                        strand: !(flag & MATE_STRAND_FLAG)
                    };
                }

                alignment.seq = seq;
                alignment.qual = qualArray;
                alignment.tagBA = new Uint8Array(ba.buffer.slice(p, blockEnd));  // decode these on demand

                if (!min || alignment.start <= max &&
                    alignment.start + alignment.lengthOnRef >= min &&
                    (undefined === filter || filter.pass(alignment))) {
                    if (chrIdx === undefined || refID == chrIdx) {
                        blocks = makeBlocks(alignment, cigarArray);
                        alignment.blocks = blocks.blocks;
                        alignment.insertions = blocks.insertions;
                        alignmentContainer.push(alignment);
                    }
                }
                offset = blockEnd;
            }
        },

        decodeSamRecords: function (sam, alignmentContainer, chr, min, max, filter) {

            var lines, i, j, len, tokens, blocks, pos, qualString, rnext, pnext, lengthOnRef,
                alignment, cigarArray, started;

            lines = sam.splitLines();
            len = lines.length;
            started = false;

            for (i = 0; i < len; i++) {

                tokens = lines[i].split('\t');

                alignment = new igv.BamAlignment();

                alignment.chr = tokens[2];
                alignment.start = Number.parseInt(tokens[3]) - 1;
                alignment.flags = Number.parseInt(tokens[1]);
                alignment.readName = tokens[0];
                alignment.strand = !(alignment.flags & READ_STRAND_FLAG);
                alignment.mq = Number.parseInt(tokens[4]);
                alignment.cigar = tokens[5];
                alignment.fragmentLength = Number.parseInt(tokens[8]);
                alignment.seq = tokens[9];

                if (alignment.chr === '*' || !alignment.isMapped()) continue;  // Unmapped

                if (alignment.chr !== chr) {
                    if (started) break; // Off the right edge, we're done
                    else  continue; // Possibly to the left, skip but keep looping
                } else if (alignment.start > max) {
                    break;    // off right edge, we're done
                }

                lengthOnRef = 0;
                cigarArray = buildOperators(alignment.cigar);
                cigarArray.forEach(function (op) {
                    var opLen = op.len;
                    var opLtr = op.ltr;
                    if (opLtr == 'M' || opLtr == 'EQ' || opLtr == 'X' || opLtr == 'D' || opLtr == 'N' || opLtr == '=')
                        lengthOnRef += opLen;
                });
                alignment.lengthOnRef = lengthOnRef;
                // TODO for lh3: parse the CG:B,I tag in SAM here

                if (alignment.start + lengthOnRef < min) {
                    continue;    // To the left, skip and continue
                }


                qualString = tokens[10];
                alignment.qual = [];
                for (j = 0; j < qualString.length; j++) {
                    alignment.qual[j] = qualString.charCodeAt(j) - 33;
                }
                alignment.tagDict = tokens.length < 11 ? {} : decodeSamTags(tokens.slice(11));

                if (alignment.isMateMapped()) {
                    rnext = tokens[6];
                    alignment.mate = {
                        chr: (rnext === '=') ? alignment.chr : rnext,
                        position: Number.parseInt(tokens[7]),
                        strand: !(alignment.flags & MATE_STRAND_FLAG)
                    };
                }

                if (undefined === filter || filter.pass(alignment)) {
                    blocks = makeBlocks(alignment, cigarArray);
                    alignment.blocks = blocks.blocks;
                    alignment.insertions = blocks.insertions;
                    alignmentContainer.push(alignment);
                }
            }
        }
    };


    /**
     * Split the alignment record into blocks as specified in the cigarArray.  Each aligned block contains
     * its portion of the read sequence and base quality strings.  A read sequence or base quality string
     * of "*" indicates the value is not recorded.  In all other cases the length of the block sequence (block.seq)
     * and quality string (block.qual) must == the block length.
     *
     * NOTE: Insertions are not yet treated // TODO
     *
     * @param record
     * @param cigarArray
     * @returns array of blocks
     */
    function makeBlocks(record, cigarArray) {

        var blocks = [],
            insertions,
            seqOffset = 0,
            pos = record.start,
            len = cigarArray.length,
            blockSeq,
            blockQuals,
            gapType,
            minQ = 5,  //prefs.getAsInt(PreferenceManager.SAM_BASE_QUALITY_MIN)
            maxQ = 20; //prefs.getAsInt(PreferenceManager.SAM_BASE_QUALITY_MAX)

        for (var i = 0; i < len; i++) {

            var c = cigarArray[i];

            switch (c.ltr) {
                case 'H' :
                    break; // ignore hard clips
                case 'P' :
                    break; // ignore pads
                case 'S' :
                    seqOffset += c.len;
                    gapType = 'S';
                    break; // soft clip read bases
                case 'N' :
                    pos += c.len;
                    gapType = 'N';
                    break;  // reference skip
                case 'D' :
                    pos += c.len;
                    gapType = 'D';
                    break;
                case 'I' :
                    blockSeq = record.seq === '*' ? '*' : record.seq.substr(seqOffset, c.len);
                    blockQuals = record.qual ? record.qual.slice(seqOffset, c.len) : undefined;
                    if (insertions === undefined) insertions = [];
                    insertions.push({start: pos, len: c.len, seq: blockSeq, qual: blockQuals});
                    seqOffset += c.len;
                    break;
                case 'M' :
                case 'EQ' :
                case '=' :
                case 'X' :

                    blockSeq = record.seq === '*' ? '*' : record.seq.substr(seqOffset, c.len);
                    blockQuals = record.qual ? record.qual.slice(seqOffset, c.len) : undefined;
                    blocks.push({start: pos, len: c.len, seq: blockSeq, qual: blockQuals, gapType: gapType});
                    seqOffset += c.len;
                    pos += c.len;

                    break;

                default :
                    console.log('Error processing cigar element: ' + c.len + c.ltr);
            }
        }

        return {blocks: blocks, insertions: insertions};

    }

    function readInt(ba, offset) {
        return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
    }

    function readShort(ba, offset) {
        return (ba[offset + 1] << 8) | (ba[offset]);
    }

    /**
     * Read unsigned int from 32 bit little-endian
     *
     * Bitwise operations are only safe for int32. Use >>> 0 to show intention
     * of unsigned operation. Otherwise a bit will be used for sign.
     *
     * @example
     * var c = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
     * readUInt(c, 0).toString(16);
     * > 'ffffffff'
     *
     * @param  {Uint8Array} ba byte array with little endian encoded int
     * @param  {number} offset where to start reading the bytes
     * @return {number}        number with decoded value
     */
    function readUInt(ba, offset) {
        if (ba.length < ( offset + 4 )) {
            throw 'Array index out of bounds when reading UInt32';
        }
        return (((ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset])) >>> 0);
    }

    /**
     * Build a list of cigar operators from a cigarString.  Removes padding operators and concatenates consecutive
     * operators of the same type
     *
     * @param cigarString
     * @return
     */
    function buildOperators(cigarString) {

        var operators, buffer, i, len, prevOp, next, op, nBases;

        operators = [];
        buffer = [];

        // Create list of cigar operators
        prevOp = null;
        len = cigarString.length;
        for (i = 0; i < len; i++) {
            next = cigarString.charAt(i);
            if (isDigit(next)) {
                buffer.push(next);
            } else {
                op = next;
                nBases = Number.parseInt(buffer.join(''));
                buffer = [];

                if (prevOp != null && prevOp.ltr == op) {
                    prevOp.len += nBases;
                } else {
                    prevOp = {len: nBases, ltr: op};
                    operators.push(prevOp);
                }
            }
        }
        return operators;

    }

    function isDigit(a) {
        var charCode = a.charCodeAt(0);
        return (charCode >= 48 && charCode <= 57); // 0-9
    }

    function decodeSamTags(tags) {

        var tagDict = {};
        tags.forEach(function (tag) {
            var tokens = tag.split(':');
            tagDict[tokens[0]] = tokens[2];
        });

        return tagDict;

    }


    return igv;

})
(igv || {});


