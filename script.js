/* =========================================================
   NIGERIA PAYE COMPUTATION SYSTEM
   PAYSLIP OCR + PDF OCR + CAMERA DOCUMENT SCANNER
   EXCEL PAYROLL + RENT RELIEF
   Built by Mudris Tech Solution
   ========================================================= */


/* =========================================================
   TAX CONFIGURATION
   ========================================================= */

const TAX_FREE = 800000;

const TAX_BANDS = [
    { limit: 2200000, rate: 0.15 },
    { limit: 6800000, rate: 0.18 },
    { limit: 4000000, rate: 0.21 },
    { limit: 12000000, rate: 0.23 },
    { limit: Infinity, rate: 0.25 }
];


/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

let selectedFile = null;

let capturedCameraBlob = null;

let cameraStream = null;

let processedData = [];


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function money(value) {

    return new Intl.NumberFormat(
        "en-NG",
        {
            style: "currency",
            currency: "NGN",
            maximumFractionDigits: 2
        }
    ).format(
        Number(value) || 0
    );
}


function numberValue(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return 0;
    }

    if (
        typeof value === "number"
    ) {
        return Number.isFinite(value)
            ? value
            : 0;
    }

    const n =
        parseFloat(
            String(value)
                .replace(/₦/g, "")
                .replace(/NGN/gi, "")
                .replace(/N(?=\s*\d)/gi, "")
                .replace(/,/g, "")
                .replace(/\s/g, "")
        );

    return Number.isFinite(n)
        ? n
        : 0;
}


function normalizeText(text) {

    return String(text || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n")
        .trim();
}


function escapeHTML(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   PAYE CALCULATION
   ========================================================= */

function computePAYE(
    monthlyGross,
    pension = 0,
    nhf = 0,
    nhis = 0,
    rentReliefMonthly = 0
) {

    const gross =
        numberValue(
            monthlyGross
        );

    const annualGross =
        gross * 12;

    const annualPension =
        numberValue(
            pension
        ) * 12;

    const annualNHF =
        numberValue(
            nhf
        ) * 12;

    const annualNHIS =
        numberValue(
            nhis
        ) * 12;

    const annualRentRelief =
        numberValue(
            rentReliefMonthly
        ) * 12;


    let taxableIncome =
        annualGross -
        annualPension -
        annualNHF -
        annualNHIS -
        annualRentRelief -
        TAX_FREE;


    taxableIncome =
        Math.max(
            0,
            taxableIncome
        );


    let remaining =
        taxableIncome;

    let annualTax =
        0;


    for (
        const band of TAX_BANDS
    ) {

        if (
            remaining <= 0
        ) {
            break;
        }


        const amount =
            Math.min(
                remaining,
                band.limit
            );


        annualTax +=
            amount *
            band.rate;


        remaining -=
            amount;
    }


    return annualTax / 12;
}


/* =========================================================
   RENT RELIEF
   ========================================================= */

function calculateRentRelief(
    annualRent,
    employerHousing = false
) {

    const rent =
        numberValue(
            annualRent
        );


    if (
        rent <= 0 ||
        employerHousing
    ) {
        return 0;
    }


    return Math.min(
        rent * 0.20,
        500000
    );
}


function getCurrentRentRelief() {

    const rent =
        numberValue(
            document.getElementById(
                "rentAmount"
            )?.value
        );


    const employerHousing =
        document.getElementById(
            "employerHouse"
        )?.checked || false;


    return calculateRentRelief(
        rent,
        employerHousing
    );
}


/* =========================================================
   TESSERACT
   ========================================================= */

async function initializeOCR() {

    if (
        !window.Tesseract
    ) {

        throw new Error(
            "Tesseract OCR library could not be loaded."
        );
    }


    if (
        typeof Tesseract.recognize !==
        "function"
    ) {

        throw new Error(
            "Tesseract OCR is unavailable."
        );
    }


    return true;
}


/* =========================================================
   OCR SINGLE IMAGE
   ========================================================= */

async function recognizeImage(
    image
) {

    await initializeOCR();


    const loading =
        document.getElementById(
            "loading"
        );


    const result =
        await Tesseract.recognize(
            image,
            "eng",
            {

                logger:
                    function(message) {

                        if (
                            !message ||
                            !loading
                        ) {
                            return;
                        }


                        if (
                            message.status ===
                            "recognizing text"
                        ) {

                            const progress =
                                Math.round(
                                    (
                                        message.progress ||
                                        0
                                    ) * 100
                                );


                            loading.textContent =
                                `Reading payslip... ${progress}%`;

                        } else if (
                            message.status
                        ) {

                            loading.textContent =
                                `OCR: ${message.status}`;
                        }
                    }
            }
        );


    return normalizeText(
        result?.data?.text ||
        ""
    );
}


/* =========================================================
   IMAGE PREPARATION
   ========================================================= */

function resizeCanvas(
    source,
    scale = 2
) {

    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        Math.max(
            1,
            Math.round(
                source.width *
                scale
            )
        );


    canvas.height =
        Math.max(
            1,
            Math.round(
                source.height *
                scale
            )
        );


    const ctx =
        canvas.getContext(
            "2d"
        );


    ctx.imageSmoothingEnabled =
        true;


    ctx.imageSmoothingQuality =
        "high";


    ctx.drawImage(
        source,
        0,
        0,
        canvas.width,
        canvas.height
    );


    return canvas;
}


/* =========================================================
   GRAYSCALE / CONTRAST
   ========================================================= */

function createEnhancedCanvas(
    source,
    mode = "gray"
) {

    const canvas =
        resizeCanvas(
            source,
            2
        );


    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently:
                    true
            }
        );


    const image =
        ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );


    const data =
        image.data;


    for (
        let i = 0;
        i < data.length;
        i += 4
    ) {

        let gray =
            (
                0.299 *
                data[i]
            ) +
            (
                0.587 *
                data[i + 1]
            ) +
            (
                0.114 *
                data[i + 2]
            );


        if (
            mode === "contrast"
        ) {

            gray =
                (
                    gray -
                    128
                ) *
                1.45 +
                128;

        }


        if (
            mode === "threshold"
        ) {

            gray =
                gray >
                165
                    ? 255
                    : 0;
        }


        gray =
            Math.max(
                0,
                Math.min(
                    255,
                    gray
                )
            );


        data[i] =
            gray;

        data[i + 1] =
            gray;

        data[i + 2] =
            gray;
    }


    ctx.putImageData(
        image,
        0,
        0
    );


    return canvas;
}


/* =========================================================
   DOCUMENT CROP
   ========================================================= */

function createDocumentCrop(
    source
) {

    /*
     * We don't aggressively crop the
     * camera image because the user may
     * hold the payslip differently.
     *
     * Instead we remove a small amount
     * of the outer scene and preserve
     * most of the document.
     */

    const width =
        source.width;

    const height =
        source.height;


    const cropX =
        Math.round(
            width * 0.06
        );


    const cropY =
        Math.round(
            height * 0.04
        );


    const cropWidth =
        Math.round(
            width * 0.88
        );


    const cropHeight =
        Math.round(
            height * 0.92
        );


    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        cropWidth;

    canvas.height =
        cropHeight;


    const ctx =
        canvas.getContext(
            "2d"
        );


    ctx.imageSmoothingEnabled =
        true;


    ctx.imageSmoothingQuality =
        "high";


    ctx.drawImage(
        source,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
    );


    return canvas;
}


/* =========================================================
   CANVAS TO BLOB
   ========================================================= */

function canvasToBlob(
    canvas,
    quality = 0.97
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            canvas.toBlob(
                function(blob) {

                    if (!blob) {

                        reject(
                            new Error(
                                "Unable to create OCR image."
                            )
                        );

                        return;
                    }


                    resolve(
                        blob
                    );
                },
                "image/jpeg",
                quality
            );
        }
    );
}


/* =========================================================
   OCR TEXT NORMALIZATION
   ========================================================= */

function normalizeOCRLabels(
    text
) {

    return String(text || "")

        .replace(
            /GROSS\s+PAVY/gi,
            "GROSS PAY"
        )

        .replace(
            /GROSS\s+PAV/gi,
            "GROSS PAY"
        )

        .replace(
            /GROSS\s+PAYV/gi,
            "GROSS PAY"
        )

        .replace(
            /GROSS\s+SALARV/gi,
            "GROSS SALARY"
        )

        .replace(
            /GROSS\s+SALAR[YT]/gi,
            "GROSS SALARY"
        )

        .replace(
            /PENS[|I1]ON/gi,
            "PENSION"
        )

        .replace(
            /NHI[S5]/gi,
            "NHIS"
        )

        .replace(
            /N[Hh][Ff]/g,
            "NHF"
        );
}


/* =========================================================
   OCR QUALITY SCORING
   ========================================================= */

function containsImportantPayslipWords(
    text
) {

    const upper =
        normalizeOCRLabels(
            text
        ).toUpperCase();


    const words = [

        "GROSS",

        "SALARY",

        "PENSION",

        "NHF",

        "NHIS",

        "EARNINGS",

        "DEDUCTION",

        "NET PAY"
    ];


    let matches =
        0;


    for (
        const word of words
    ) {

        if (
            upper.includes(
                word
            )
        ) {

            matches++;
        }
    }


    return matches >= 2;
}


/* =========================================================
   EXTRACT MONEY TOKENS
   ========================================================= */

function extractMoney(
    text
) {

    const matches =
        String(text || "")
            .replace(
                /₦/g,
                " "
            )
            .replace(
                /NGN/gi,
                " "
            )
            .match(
                /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b/g
            ) ||
            [];


    return matches
        .map(
            raw => ({

                raw,

                value:
                    numberValue(
                        raw
                    )
            })
        )
        .filter(
            item =>
                item.value > 0
        );
}


/* =========================================================
   LABEL-SPECIFIC VALUE EXTRACTION
   ========================================================= */

function findValueNearLabel(
    text,
    labels
) {

    const lines =
        normalizeText(
            text
        )
        .split("\n")
        .map(
            line =>
                line.trim()
        )
        .filter(Boolean);


    const orderedLabels =
        [...labels].sort(
            (
                a,
                b
            ) =>
                b.length -
                a.length
        );


    const stopLabels = [

        "TOTAL DEDUCTION",

        "NET PAY",

        "NET SALARY",

        "PENSION DEDUCTION",

        "PENSION",

        "NHF",

        "NHIS",

        "PAYE",

        "TAX",

        "BASIC SALARY",

        "ALLOWANCE",

        "TOTAL EARNINGS",

        "TOTAL PAY"
    ];


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const line =
            lines[i];


        const upper =
            line.toUpperCase();


        for (
            const label of orderedLabels
        ) {

            const position =
                upper.indexOf(
                    label.toUpperCase()
                );


            if (
                position <
                0
            ) {

                continue;
            }


            let after =
                line.slice(
                    position +
                    label.length
                );


            const upperAfter =
                after.toUpperCase();


            let stopAt =
                after.length;


            for (
                const stop of stopLabels
            ) {

                const stopPosition =
                    upperAfter.indexOf(
                        stop
                    );


                if (
                    stopPosition >= 0 &&
                    stopPosition < stopAt
                ) {

                    stopAt =
                        stopPosition;
                }
            }


            after =
                after.slice(
                    0,
                    stopAt
                );


            const sameLine =
                extractMoney(
                    after
                );


            if (
                sameLine.length
            ) {

                /*
                 * IMPORTANT:
                 * Take the FIRST number after
                 * the label.
                 *
                 * Example:
                 *
                 * GROSS PAY : 175,441.50
                 * TOTAL DEDUCTION : 18,561.81
                 *
                 * Gross must be 175,441.50.
                 */

                return sameLine[0].value;
            }


            for (
                let j = i + 1;
                j <= i + 2 &&
                j < lines.length;
                j++
            ) {

                const nextUpper =
                    lines[j]
                        .toUpperCase();


                if (
                    stopLabels.some(
                        stop =>
                            nextUpper.includes(
                                stop
                            )
                    )
                ) {

                    break;
                }


                const nearby =
                    extractMoney(
                        lines[j]
                    );


                if (
                    nearby.length
                ) {

                    return nearby[0].value;
                }
            }
        }
    }


    return 0;
}


/* =========================================================
   PAYSLIP DATA EXTRACTION
   ========================================================= */

function extractPayslipData(
    text
) {

    const normalized =
        normalizeOCRLabels(
            text
        );


    const gross =
        findValueNearLabel(
            normalized,
            [

                "GROSS SALARY",

                "GROSS PAY",

                "TOTAL GROSS",

                "GROSS INCOME",

                "TOTAL EARNINGS",

                "TOTAL PAY",

                "GROSS"
            ]
        );


    const pension =
        findValueNearLabel(
            normalized,
            [

                "PENSION DEDUCTION",

                "PENSION",

                "PEN"
            ]
        );


    const nhf =
        findValueNearLabel(
            normalized,
            [

                "NATIONAL HOUSING FUND",

                "NHF"
            ]
        );


    const nhis =
        findValueNearLabel(
            normalized,
            [

                "NATIONAL HEALTH INSURANCE",

                "NHIS",

                "HEALTH INSURANCE"
            ]
        );


    return {

        gross,

        pension,

        nhf,

        nhis
    };
}


/* =========================================================
   OCR SCORE
   ========================================================= */

function scoreOCRText(
    text
) {

    const normalized =
        normalizeOCRLabels(
            text
        );


    const data =
        extractPayslipData(
            normalized
        );


    let score =
        0;


    if (
        data.gross > 0
    ) {

        score +=
            150;
    }


    if (
        data.pension > 0
    ) {

        score +=
            20;
    }


    if (
        data.nhf > 0
    ) {

        score +=
            10;
    }


    if (
        data.nhis > 0
    ) {

        score +=
            10;
    }


    if (
        normalized
            .toUpperCase()
            .includes(
                "GROSS"
            )
    ) {

        score +=
            50;
    }


    if (
        normalized
            .toUpperCase()
            .includes(
                "PAY"
            )
    ) {

        score +=
            20;
    }


    if (
        containsImportantPayslipWords(
            normalized
        )
    ) {

        score +=
            40;
    }


    /*
     * Penalize obviously corrupted OCR.
     */

    const badCharacters =
        (
            normalized.match(
                /[{}[\]<>|~^`@#$%*+=]/g
            ) ||
            []
        ).length;


    score -=
        Math.min(
            badCharacters,
            50
        );


    return score;
}


/* =========================================================
   MULTI-VARIANT OCR
   ========================================================= */

async function performOCR(
    sourceCanvas
) {

    const variants = [];


    /*
     * VARIANT 1
     * Original image.
     *
     * This is particularly important
     * for phone camera photographs.
     */

    variants.push(
        resizeCanvas(
            sourceCanvas,
            2
        )
    );


    /*
     * VARIANT 2
     * Grayscale.
     */

    variants.push(
        createEnhancedCanvas(
            sourceCanvas,
            "gray"
        )
    );


    /*
     * VARIANT 3
     * Higher contrast.
     */

    variants.push(
        createEnhancedCanvas(
            sourceCanvas,
            "contrast"
        )
    );


    /*
     * VARIANT 4
     * Threshold.
     */

    variants.push(
        createEnhancedCanvas(
            sourceCanvas,
            "threshold"
        )
    );


    /*
     * VARIANT 5
     * Document crop.
     */

    const cropped =
        createDocumentCrop(
            sourceCanvas
        );


    variants.push(
        resizeCanvas(
            cropped,
            2.5
        )
    );


    let bestText =
        "";

    let bestScore =
        -Infinity;


    for (
        let i = 0;
        i < variants.length;
        i++
    ) {

        const loading =
            document.getElementById(
                "loading"
            );


        if (loading) {

            loading.textContent =
                `Reading payslip image ${i + 1} of ${variants.length}...`;
        }


        try {

            const blob =
                await canvasToBlob(
                    variants[i],
                    0.97
                );


            const text =
                await recognizeImage(
                    blob
                );


            const score =
                scoreOCRText(
                    text
                );


            console.log(
                "OCR variant",
                i + 1,
                "score:",
                score,
                text
            );


            if (
                score >
                bestScore
            ) {

                bestScore =
                    score;

                bestText =
                    text;
            }


            /*
             * If we already have a very strong
             * payslip OCR result, stop early.
             */

            const extracted =
                extractPayslipData(
                    text
                );


            if (
                extracted.gross > 0 &&
                containsImportantPayslipWords(
                    text
                )
            ) {

                if (
                    score >= 220
                ) {

                    break;
                }
            }

        } catch (error) {

            console.warn(
                "OCR variant failed:",
                error
            );
        }
    }


    return bestText;
}


/* =========================================================
   IMAGE FILE TO CANVAS
   ========================================================= */

function imageFileToCanvas(
    file
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            const image =
                new Image();


            const url =
                URL.createObjectURL(
                    file
                );


            image.onload =
                function() {

                    const canvas =
                        document.createElement(
                            "canvas"
                        );


                    canvas.width =
                        image.naturalWidth;


                    canvas.height =
                        image.naturalHeight;


                    const ctx =
                        canvas.getContext(
                            "2d"
                        );


                    ctx.drawImage(
                        image,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );


                    URL.revokeObjectURL(
                        url
                    );


                    resolve(
                        canvas
                    );
                };


            image.onerror =
                function() {

                    URL.revokeObjectURL(
                        url
                    );


                    reject(
                        new Error(
                            "Could not read image."
                        )
                    );
                };


            image.src =
                url;
        }
    );
}


/* =========================================================
   PROCESS IMAGE
   ========================================================= */

async function processImageFile(
    file
) {

    if (!file) {

        throw new Error(
            "No image was selected."
        );
    }


    const canvas =
        await imageFileToCanvas(
            file
        );


    const text =
        await performOCR(
            canvas
        );


    return {

        text,

        data:
            extractPayslipData(
                text
            )
    };
}


/* =========================================================
   DISPLAY PAYSLIP RESULT
   ========================================================= */

function displayPayslipResult(
    data,
    ocrText = ""
) {

    const result =
        document.getElementById(
            "result"
        );


    if (!result) {
        return;
    }


    if (
        !data ||
        !data.gross
    ) {

        result.innerHTML = `

            <div class="error">

                <strong>
                Could not confidently identify Gross Salary.
                </strong>

                <br><br>

                Please make sure the payslip is clear,
                fully visible and well lit.

            </div>

            <details>

                <summary>
                Show OCR text
                </summary>

                <pre style="
                    white-space:pre-wrap;
                    margin-top:10px;
                    font-size:11px;
                ">${escapeHTML(
                    ocrText
                )}</pre>

            </details>
        `;


        return;
    }


    const rentReliefAnnual =
        getCurrentRentRelief();


    const paye =
        computePAYE(
            data.gross,
            data.pension,
            data.nhf,
            data.nhis,
            rentReliefAnnual / 12
        );


    result.innerHTML = `

        <div class="success">

            <strong>
            PAYE computation completed
            </strong>

        </div>


        <table>

            <tr>

                <th>
                Item
                </th>

                <th>
                Amount
                </th>

            </tr>


            <tr>

                <td>
                Gross Salary
                </td>

                <td>
                ${money(
                    data.gross
                )}
                </td>

            </tr>


            <tr>

                <td>
                Pension
                </td>

                <td>
                ${money(
                    data.pension
                )}
                </td>

            </tr>


            <tr>

                <td>
                NHF
                </td>

                <td>
                ${money(
                    data.nhf
                )}
                </td>

            </tr>


            <tr>

                <td>
                NHIS
                </td>

                <td>
                ${money(
                    data.nhis
                )}
                </td>

            </tr>


            <tr>

                <td>
                Rent Relief Applied
                </td>

                <td>
                ${money(
                    rentReliefAnnual
                )}
                </td>

            </tr>


            <tr>

                <th>
                PAYE Under Current Tax Reform
                </th>

                <th>
                ${money(
                    paye
                )}
                </th>

            </tr>

        </table>


        <details style="
            margin-top:15px;
        ">

            <summary>
            Show extracted information
            </summary>


            <pre style="
                white-space:pre-wrap;
                margin-top:10px;
                font-size:11px;
            ">${escapeHTML(
                ocrText
            )}</pre>

        </details>
    `;
}


/* =========================================================
   PROCESS SELECTED FILE
   ========================================================= */

async function processSelectedFile() {

    const loading =
        document.getElementById(
            "loading"
        );


    const result =
        document.getElementById(
            "result"
        );


    try {

        let file =
            selectedFile;


        if (!file) {

            const input =
                document.getElementById(
                    "galleryInput"
                );


            if (
                input?.files?.length
            ) {

                file =
                    input.files[0];
            }
        }


        if (
            !file &&
            capturedCameraBlob
        ) {

            file =
                new File(
                    [
                        capturedCameraBlob
                    ],
                    "camera-payslip.jpg",
                    {
                        type:
                            "image/jpeg"
                    }
                );
        }


        if (!file) {

            if (result) {

                result.innerHTML = `

                    <div class="warning">

                    Please select a payslip image,
                    PDF, or scan one with the camera.

                    </div>
                `;
            }


            return;
        }


        if (loading) {

            loading.textContent =
                "Preparing payslip...";
        }


        if (
            file.type ===
            "application/pdf" ||
            file.name
                .toLowerCase()
                .endsWith(".pdf")
        ) {

            await processPDF(
                file
            );


            return;
        }


        const response =
            await processImageFile(
                file
            );


        displayPayslipResult(
            response.data,
            response.text
        );


        if (loading) {

            loading.textContent =
                "OCR completed.";
        }

    } catch (error) {

        console.error(
            "OCR error:",
            error
        );


        if (loading) {

            loading.textContent =
                "";
        }


        if (result) {

            result.innerHTML = `

                <div class="error">

                    <strong>
                    OCR processing failed.
                    </strong>

                    <br><br>

                    ${escapeHTML(
                        error.message ||
                        "Please try again."
                    )}

                </div>
            `;
        }
    }
}


/* =========================================================
   PDF OCR
   ========================================================= */

async function processPDF(
    file
) {

    const loading =
        document.getElementById(
            "loading"
        );


    const result =
        document.getElementById(
            "result"
        );


    try {

        if (
            !window.pdfjsLib
        ) {

            throw new Error(
                "PDF reader could not be loaded."
            );
        }


        pdfjsLib
            .GlobalWorkerOptions
            .workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";


        const buffer =
            await file.arrayBuffer();


        const pdf =
            await pdfjsLib
                .getDocument({
                    data:
                        buffer
                })
                .promise;


        let combinedText =
            "";


        for (
            let pageNumber = 1;
            pageNumber <=
            pdf.numPages;
            pageNumber++
        ) {

            if (loading) {

                loading.textContent =
                    `Processing PDF page ${pageNumber} of ${pdf.numPages}...`;
            }


            const page =
                await pdf.getPage(
                    pageNumber
                );


            const viewport =
                page.getViewport({
                    scale:
                        2.5
                });


            const canvas =
                document.createElement(
                    "canvas"
                );


            canvas.width =
                Math.ceil(
                    viewport.width
                );


            canvas.height =
                Math.ceil(
                    viewport.height
                );


            const context =
                canvas.getContext(
                    "2d"
                );


            await page.render({

                canvasContext:
                    context,

                viewport:
                    viewport

            }).promise;


            const pageText =
                await performOCR(
                    canvas
                );


            combinedText +=
                "\n" +
                pageText;
        }


        combinedText =
            normalizeText(
                combinedText
            );


        const data =
            extractPayslipData(
                combinedText
            );


        displayPayslipResult(
            data,
            combinedText
        );


        if (loading) {

            loading.textContent =
                "PDF OCR completed.";
        }

    } catch (error) {

        console.error(
            "PDF OCR error:",
            error
        );


        if (result) {

            result.innerHTML = `

                <div class="error">

                    <strong>
                    PDF processing failed.
                    </strong>

                    <br><br>

                    ${escapeHTML(
                        error.message ||
                        "Please try again."
                    )}

                </div>
            `;
        }


        if (loading) {

            loading.textContent =
                "";
        }
    }
}


/* =========================================================
   CAMERA
   ========================================================= */

async function openCameraScanner() {

    const modal =
        document.getElementById(
            "cameraModal"
        );


    const video =
        document.getElementById(
            "cameraVideo"
        );


    const status =
        document.getElementById(
            "cameraStatus"
        );


    if (
        !modal ||
        !video
    ) {

        alert(
            "Camera interface could not be loaded."
        );


        return;
    }


    try {

        if (
            !window.isSecureContext
        ) {

            throw new Error(
                "Camera access requires HTTPS."
            );
        }


        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "This browser does not support camera access."
            );
        }


        modal.classList.add(
            "active"
        );


        if (status) {

            status.style.display =
                "block";

            status.textContent =
                "Starting rear camera...";
        }


        cameraStream =
            await navigator.mediaDevices
                .getUserMedia({

                    video: {

                        facingMode: {
                            ideal:
                                "environment"
                        },


                        width: {
                            ideal:
                                2560
                        },


                        height: {
                            ideal:
                                1440
                        },


                        frameRate: {
                            ideal:
                                30,
                            max:
                                30
                        }
                    },


                    audio:
                        false
                });


        video.srcObject =
            cameraStream;


        video.setAttribute(
            "autoplay",
            "true"
        );


        video.setAttribute(
            "playsinline",
            "true"
        );


        await video.play();


        /*
         * Try to enable continuous autofocus.
         */

        const track =
            cameraStream
                .getVideoTracks()[0];


        if (
            track &&
            track.applyConstraints
        ) {

            try {

                await track.applyConstraints({

                    advanced: [

                        {
                            focusMode:
                                "continuous"
                        },

                        {
                            exposureMode:
                                "continuous"
                        },

                        {
                            whiteBalanceMode:
                                "continuous"
                        }

                    ]

                });

            } catch (
                constraintError
            ) {

                console.log(
                    "Advanced camera controls not supported:",
                    constraintError
                );
            }
        }


        /*
         * Display useful instructions.
         */

        if (status) {

            status.style.display =
                "block";


            status.innerHTML = `

                <strong>
                Position the payslip clearly inside the frame.
                </strong>

                <br>

                Move closer until the text is sharp.

                <br>

                Hold the phone steady.

            `;
        }

    } catch (error) {

        console.error(
            "Camera error:",
            error
        );


        stopCameraStream();


        modal.classList.remove(
            "active"
        );


        alert(
            error.message ||
            "Unable to access camera."
        );
    }
}


/* =========================================================
   TRUE STILL PHOTO CAPTURE
   ========================================================= */

async function captureStillPhoto(
    video,
    track
) {

    /*
     * Modern Android browsers may support
     * ImageCapture. This gives us a real
     * camera photograph instead of a video
     * frame.
     */

    if (
        typeof ImageCapture !==
        "undefined" &&
        track
    ) {

        try {

            const imageCapture =
                new ImageCapture(
                    track
                );


            const photo =
                await imageCapture
                    .takePhoto();


            if (
                photo &&
                photo.size > 0
            ) {

                return photo;
            }

        } catch (error) {

            console.log(
                "Still photo capture unavailable. Falling back to video frame.",
                error
            );
        }
    }


    /*
     * Fallback:
     * capture the highest resolution
     * frame available from the video.
     */

    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        video.videoWidth;


    canvas.height =
        video.videoHeight;


    const context =
        canvas.getContext(
            "2d"
        );


    context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );


    return await canvasToBlob(
        canvas,
        0.98
    );
}


/* =========================================================
   CAMERA CAPTURE AND OCR
   ========================================================= */

async function capturePayslipImage() {

    const video =
        document.getElementById(
            "cameraVideo"
        );


    const cameraCanvas =
        document.getElementById(
            "cameraCanvas"
        );


    const status =
        document.getElementById(
            "cameraStatus"
        );


    const loading =
        document.getElementById(
            "loading"
        );


    const result =
        document.getElementById(
            "result"
        );


    if (
        !video
    ) {

        alert(
            "Camera video is unavailable."
        );


        return;
    }


    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {

        alert(
            "Camera is not ready yet. Please wait a moment."
        );


        return;
    }


    try {

        if (status) {

            status.style.display =
                "block";


            status.textContent =
                "Taking high-resolution photo...";
        }


        const track =
            cameraStream
                ?.getVideoTracks()
                ?.[0];


        const blob =
            await captureStillPhoto(
                video,
                track
            );


        if (
            !blob ||
            !blob.size
        ) {

            throw new Error(
                "The camera could not produce a usable image."
            );
        }


        capturedCameraBlob =
            blob;


        selectedFile =
            new File(
                [
                    blob
                ],
                "payslip-camera.jpg",
                {
                    type:
                        blob.type ||
                        "image/jpeg"
                }
            );


        /*
         * Also copy the image into the
         * existing camera canvas when available.
         */

        if (
            cameraCanvas
        ) {

            const image =
                new Image();


            const url =
                URL.createObjectURL(
                    blob
                );


            await new Promise(
                (
                    resolve
                ) => {

                    image.onload =
                        function() {

                            cameraCanvas.width =
                                image.naturalWidth;


                            cameraCanvas.height =
                                image.naturalHeight;


                            const ctx =
                                cameraCanvas
                                    .getContext(
                                        "2d"
                                    );


                            ctx.drawImage(
                                image,
                                0,
                                0,
                                cameraCanvas.width,
                                cameraCanvas.height
                            );


                            URL.revokeObjectURL(
                                url
                            );


                            resolve();
                        };


                    image.onerror =
                        function() {

                            URL.revokeObjectURL(
                                url
                            );


                            resolve();
                        };


                    image.src =
                        url;
                }
            );
        }


        /*
         * Stop camera before OCR.
         */

        stopCameraStream();


        document
            .getElementById(
                "cameraModal"
            )
            ?.classList.remove(
                "active"
            );


        if (loading) {

            loading.textContent =
                "Preparing high-resolution camera image...";
        }


        if (result) {

            result.innerHTML = `

                <div class="warning">

                    📷 Payslip captured successfully.

                    <br><br>

                    Enhancing the document and reading text...
                    
                </div>
            `;
        }


        /*
         * IMPORTANT:
         *
         * The camera photo now goes through
         * exactly the same OCR pipeline as
         * uploaded images and PDFs.
         */

        const response =
            await processImageFile(
                selectedFile
            );


        displayPayslipResult(
            response.data,
            response.text
        );


        if (loading) {

            loading.textContent =
                "Camera OCR completed.";
        }

    } catch (error) {

        console.error(
            "Camera OCR error:",
            error
        );


        stopCameraStream();


        document
            .getElementById(
                "cameraModal"
            )
            ?.classList.remove(
                "active"
            );


        if (loading) {

            loading.textContent =
                "";
        }


        if (result) {

            result.innerHTML = `

                <div class="error">

                    <strong>
                    Camera OCR failed.
                    </strong>

                    <br><br>

                    ${escapeHTML(
                        error.message ||
                        "Unable to process camera image."
                    )}

                </div>

            `;
        }
    }
}


/* =========================================================
   CLOSE CAMERA
   ========================================================= */

function closeCameraScanner() {

    stopCameraStream();


    document
        .getElementById(
            "cameraModal"
        )
        ?.classList.remove(
            "active"
        );
}


/* =========================================================
   STOP CAMERA
   ========================================================= */

function stopCameraStream() {

    if (
        cameraStream
    ) {

        cameraStream
            .getTracks()
            .forEach(
                track => {

                    try {

                        track.stop();

                    } catch (_) {
                    }

                }
            );
    }


    cameraStream =
        null;


    const video =
        document.getElementById(
            "cameraVideo"
        );


    if (video) {

        video.pause();

        video.srcObject =
            null;
    }
}


/* =========================================================
   GALLERY IMAGE INPUT
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const galleryInput =
            document.getElementById(
                "galleryInput"
            );


        if (
            galleryInput
        ) {

            galleryInput.addEventListener(
                "change",
                function() {

                    if (
                        this.files &&
                        this.files.length
                    ) {

                        selectedFile =
                            this.files[0];


                        capturedCameraBlob =
                            null;
                    }
                }
            );
        }
    }
);


/* =========================================================
   RENT RELIEF
   ========================================================= */

function applyRentRelief() {

    const rent =
        numberValue(
            document.getElementById(
                "rentAmount"
            )?.value
        );


    const employerHousing =
        document.getElementById(
            "employerHouse"
        )?.checked ||
        false;


    const result =
        document.getElementById(
            "result"
        );


    if (!result) {
        return;
    }


    if (
        employerHousing
    ) {

        result.innerHTML = `

            <div class="warning">

                <strong>
                Rent Relief: ₦0
                </strong>

                <br><br>

                Employer-provided accommodation
                means rent relief does not apply.

            </div>
        `;


        return;
    }


    if (
        rent <= 0
    ) {

        result.innerHTML = `

            <div class="warning">

                No rent amount was entered.

                <br><br>

                Rent relief is ₦0.

            </div>
        `;


        return;
    }


    const relief =
        calculateRentRelief(
            rent,
            false
        );


    result.innerHTML = `

        <div class="success">

            <strong>
            Rent relief calculated successfully.
            </strong>

            <br><br>

            Annual Rent:
            <strong>
            ${money(
                rent
            )}
            </strong>

            <br>

            Rent Relief Applied:
            <strong>
            ${money(
                relief
            )}
            </strong>

            <br><br>

            Monthly equivalent used for PAYE:
            <strong>
            ${money(
                relief / 12
            )}
            </strong>

        </div>
    `;
}


/* =========================================================
   EXCEL PROCESSING
   ========================================================= */

async function processExcel() {

    const input =
        document.getElementById(
            "excelFile"
        );


    const preview =
        document.getElementById(
            "excelPreview"
        );


    const downloadButton =
        document.getElementById(
            "downloadBtn"
        );


    if (
        !input?.files?.length
    ) {

        if (preview) {

            preview.innerHTML = `

                <div class="warning">

                    Please select an Excel payroll file.

                </div>
            `;
        }


        return;
    }


    try {

        if (
            !window.XLSX
        ) {

            throw new Error(
                "Excel processing library could not be loaded."
            );
        }


        const file =
            input.files[0];


        const buffer =
            await file.arrayBuffer();


        const workbook =
            XLSX.read(
                buffer,
                {
                    type:
                        "array"
                }
            );


        const sheetName =
            workbook.SheetNames[0];


        const worksheet =
            workbook.Sheets[
                sheetName
            ];


        const rows =
            XLSX.utils.sheet_to_json(
                worksheet,
                {
                    defval:
                        ""
                }
            );


        if (
            !rows.length
        ) {

            throw new Error(
                "The Excel file contains no payroll records."
            );
        }


        processedData =
            rows.map(
                function(row) {

                    const employeeName =
                        row[
                            "Employee Name"
                        ] ||
                        row[
                            "Name"
                        ] ||
                        "";


                    const gross =
                        numberValue(
                            row[
                                "Gross Salary"
                            ]
                        );


                    const pension =
                        numberValue(
                            row[
                                "Pension"
                            ]
                        );


                    const nhf =
                        numberValue(
                            row[
                                "NHF"
                            ]
                        );


                    const nhis =
                        numberValue(
                            row[
                                "NHIS"
                            ]
                        );


                    const rent =
                        numberValue(
                            row[
                                "Rent"
                            ]
                        );


                    const housingText =
                        String(
                            row[
                                "Employer Housing"
                            ] ||
                            ""
                        )
                            .trim()
                            .toLowerCase();


                    const employerHousing =
                        housingText ===
                            "yes" ||
                        housingText ===
                            "y" ||
                        housingText ===
                            "true" ||
                        housingText ===
                            "1";


                    const rentReliefAnnual =
                        calculateRentRelief(
                            rent,
                            employerHousing
                        );


                    const paye =
                        computePAYE(
                            gross,
                            pension,
                            nhf,
                            nhis,
                            rentReliefAnnual /
                                12
                        );


                    return {

                        "Employee Name":
                            employeeName,

                        "Gross Salary":
                            gross,

                        "Pension":
                            pension,

                        "NHF":
                            nhf,

                        "NHIS":
                            nhis,

                        "Rent":
                            rent,

                        "Employer Housing":
                            employerHousing
                                ? "Yes"
                                : "No",

                        "Rent Relief Applied":
                            rentReliefAnnual,

                        "PAYE Under Current Tax Reform":
                            Number(
                                paye.toFixed(
                                    2
                                )
                            )
                    };
                }
            );


        displayExcelPreview(
            processedData
        );


        if (
            downloadButton
        ) {

            downloadButton.style.display =
                "inline-block";
        }

    } catch (error) {

        console.error(
            "Excel error:",
            error
        );


        if (preview) {

            preview.innerHTML = `

                <div class="error">

                    <strong>
                    Excel processing failed.
                    </strong>

                    <br><br>

                    ${escapeHTML(
                        error.message
                    )}

                </div>
            `;
        }
    }
}


/* =========================================================
   EXCEL PREVIEW
   ========================================================= */

function displayExcelPreview(
    data
) {

    const preview =
        document.getElementById(
            "excelPreview"
        );


    if (!preview) {
        return;
    }


    if (
        !data.length
    ) {

        preview.innerHTML =
            "<p>No records found.</p>";


        return;
    }


    const columns = [

        "Employee Name",

        "Gross Salary",

        "Pension",

        "NHF",

        "NHIS",

        "Rent",

        "Employer Housing",

        "Rent Relief Applied",

        "PAYE Under Current Tax Reform"

    ];


    const moneyColumns = [

        "Gross Salary",

        "Pension",

        "NHF",

        "NHIS",

        "Rent",

        "Rent Relief Applied",

        "PAYE Under Current Tax Reform"

    ];


    let html =
        "<div style='overflow-x:auto;'>" +
        "<table>" +
        "<thead><tr>";


    for (
        const column of columns
    ) {

        html +=
            `<th>${escapeHTML(
                column
            )}</th>`;
    }


    html +=
        "</tr></thead><tbody>";


    for (
        const row of data
    ) {

        html +=
            "<tr>";


        for (
            const column of columns
        ) {

            let value =
                row[column];


            if (
                moneyColumns.includes(
                    column
                )
            ) {

                value =
                    money(
                        value
                    );
            }


            html +=
                `<td>${escapeHTML(
                    value
                )}</td>`;
        }


        html +=
            "</tr>";
    }


    html +=
        "</tbody></table></div>";


    preview.innerHTML =
        html;
}


/* =========================================================
   DOWNLOAD EXCEL
   ========================================================= */

function downloadExcel() {

    if (
        !processedData ||
        !processedData.length
    ) {

        alert(
            "Please process a payroll file first."
        );


        return;
    }


    if (
        !window.XLSX
    ) {

        alert(
            "Excel processing library could not be loaded."
        );


        return;
    }


    const worksheet =
        XLSX.utils.json_to_sheet(
            processedData
        );


    const workbook =
        XLSX.utils.book_new();


    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "PAYE Computation"
    );


    XLSX.writeFile(
        workbook,
        "PAYE_Computation_Current_Tax_Reform.xlsx"
    );
}


/* =========================================================
   CAMERA CLEANUP
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    function() {

        if (
            document.hidden
        ) {

            stopCameraStream();
        }
    }
);


window.addEventListener(
    "beforeunload",
    function() {

        stopCameraStream();
    }
);


/* =========================================================
   END OF SCRIPT
   ========================================================= */
