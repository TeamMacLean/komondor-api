const mongoose = require('mongoose')
const LibraryType = require('./models/options/LibraryType')
const SequencingTechnology = require('./models/options/SequencingTechnology')
const LibrarySource = require('./models/options/LibrarySource')
const LibrarySelection = require('./models/options/LibrarySelection')
const LibraryStrategy = require('./models/options/LibraryStrategy')


// libraryType
function libraryType() {
    const lt = [
        { value: "CRAM", paired: false },
        { value: "BAM", paired: false },
        { value: "SFF", paired: false },
        { value: "FASTQ - Single", paired: false },
        { value: "FASTQ - Paired", paired: true },
        { value: "Complete Genomics", paired: false },
        { value: "PacBio HDF5", paired: false },
        { value: "Oxford Nanopore", paired: false }
    ]
    return Promise.all(
        lt.map(o => {
            return new Promise((resolve, reject) => {
                LibraryType.find(o)
                    .then(found => {
                        if (found && found.length) {
                            resolve();
                        } else {
                            new LibraryType({
                                value: o.value, paired: o.paired
                            })
                                .save()
                                .then(resolve)
                                .catch(reject)
                        }
                    })
                    .catch(reject)
            })
        })
    )
}


// sequencingTechnology
function sequencingTechnology() {
    const st = [
        "MinION",
        "GridION",
        "PromethION",
        "454 GS",
        "454 GS 20",
        "454 GS FLX",
        "454 GS FLX +",
        "454 GS FLX Titanium",
        "454 GS Junior",
        "Illumina Genome Analyzer",
        "Illumina Genome Analyzer II",
        "Illumina Genome Analyzer IIx",
        "Illumina HiSeq 1000",
        "Illumina HiSeq 1500",
        "Illumina HiSeq 2000",
        "Illumina HiSeq 2500",
        "Illumina HiSeq 3000",
        "Illumina HiSeq 4000",
        "Illumina HiScanSQ",
        "Illumina NextSeq 500",
        "Illumina NextSeq 550",
        "Illumina NovaSeq 6000",
        "Illumina HiSeq X Five",
        "Illumina HiSeq X Ten",
        "Illumina MiSeq",
        "Illumina MiniSeq",
        "AB SOLiD System",
        "AB SOLiD System 2.0",
        "AB SOLiD System 3.0",
        "AB SOLiD 3 Plus System",
        "AB SOLiD 4 System",
        "AB SOLiD 4hq System",
        "AB SOLiD PI System",
        "AB 5500 Genetic Analyzer",
        "AB 5500xl Genetic Analyzer",
        "AB 5500xl - W Genetic Analysis System",
        "Ion Torrent PGM",
        "Ion Torrent Proton",
        "Ion Torrent S5",
        "Ion Torrent S5 XL",
        "Complete Genomics",
        "PacBio RS",
        "PacBio RS II",
        "Sequel",
        "AB 3730xL Genetic Analyzer",
        "AB 3730 Genetic Analyzer",
        "AB 3500xL Genetic Analyzer",
        "AB 3500 Genetic Analyzer",
        "AB 3130xL Genetic Analyzer",
        "AB 3130 Genetic Analyzer",
        "AB 310 Genetic Analyzer",
        "BGISEQ - 500"
    ]
    return Promise.all(
        st.map(o => {
            return new Promise((resolve, reject) => {
                SequencingTechnology.find({ value: o })
                    .then(found => {
                        if (found && found.length) {
                            resolve();
                        } else {
                            new SequencingTechnology({
                                value: o
                            })
                                .save()
                                .then(resolve)
                                .catch(reject)
                        }
                    })
                    .catch(reject)
            })
        })
    )
}
// librarySource
function librarySource() {
    const lso = [
        "GENOMIC",
        "TRANSCRIPTOMIC",
        "METAGENOMIC",
        "METATRANSCRIPTOMIC",
        "SYNTHETIC",
        "VIRAL RNA",
        "OTHER"
    ]
    return Promise.all(
        lso.map(o => {
            return new Promise((resolve, reject) => {
                LibrarySource.find({ value: o })
                    .then(found => {
                        if (found && found.length) {
                            resolve();
                        } else {
                            new LibrarySource({
                                value: o
                            })
                                .save()
                                .then(resolve)
                                .catch(reject)
                        }
                    })
                    .catch(reject)
            })
        })
    )

}

// librarySelection
function librarySelection() {
    const lse = [
        "RANDOM",
        "PCR",
        "RANDOM PCR",
        "RT - PCR",
        "HMPR",
        "MF",
        "repeat fractionation",
        "size fractionation",
        "MSLL",
        "cDNA",
        "ChIP",
        "MNase",
        "DNase",
        "Hybrid Selection",
        "Reduced Representation",
        "Restriction Digest",
        "5 - methylcytidine antibody",
        "MBD2 protein methyl - CpG binding domain",
        "CAGE",
        "RACE",
        "MDA",
        "padlock probes capture method",
        "Oligo - dT",
        "Inverse rRNA selection",
        "ChIP - Seq",
        "other",
        "unspecified"
    ]
    return Promise.all(
        lse.map(o => {
            return new Promise((resolve, reject) => {
                LibrarySelection.find({ value: o })
                    .then(found => {
                        if (found && found.length) {
                            resolve();
                        } else {
                            new LibrarySelection({
                                value: o
                            })
                                .save()
                                .then(resolve)
                                .catch(reject)
                        }
                    })
                    .catch(reject)
            })
        })
    )
}

// libraryStrategy
function libraryStrategy() {
    const lst = [
        "WGS",
        "WGA",
        "WXS",
        "RNA - Seq",
        "ssRNA - seq",
        "miRNA - Seq",
        "ncRNA - Seq",
        "FL - cDNA",
        "EST",
        "Hi - C",
        "ATAC - seq",
        "WCS",
        "RAD - Seq",
        "CLONE",
        "POOLCLONE",
        "AMPLICON",
        "CLONEEND",
        "FINISHING",
        "ChIP - Seq",
        "MNase - Seq",
        "DNase - Hypersensitivity",
        "Bisulfite - Seq",
        "CTS",
        "MRE - Seq",
        "MeDIP - Seq",
        "MBD - Seq",
        "Tn - Seq",
        "VALIDATION",
        "FAIRE - seq",
        "SELEX",
        "RIP - Seq",
        "ChIA - PET",
        "Synthetic - Long - Read",
        "Targeted - Capture",
        "Tethered Chromatin Conformation Capture",
        "OTHER"
    ]
    return Promise.all(
        lst.map(o => {
            return new Promise((resolve, reject) => {
                LibraryStrategy.find({ value: o })
                    .then(found => {
                        if (found && found.length) {
                            resolve();
                        } else {
                            new LibraryStrategy({
                                value: o
                            })
                                .save()
                                .then(resolve)
                                .catch(reject)
                        }
                    })
                    .catch(reject)
            })
        })
    )
}



try {
    mongoose.connect('mongodb://localhost:27017/komondor', { useNewUrlParser: true });
} catch (err) {
    console.error(err);
}

const timeout = setInterval(() => { }, Number.MAX_VALUE)

Promise.all([
    libraryType(),
    sequencingTechnology(),
    librarySource(),
    librarySelection(),
    libraryStrategy()
])
    .then(() => {
        console.log('done')
        clearInterval(timeout);
    })
    .catch(err => {
        console.error(err);
        clearInterval(timeout);
    })
