/* =========================================================
   NIGERIA PAYE COMPUTATION SYSTEM
   Camera OCR + Payslip OCR + Excel Payroll
   Built by Mudris Tech Solution
   ========================================================= */

const TAX_FREE = 800000;

const TAX_BANDS = [
    { limit: 2200000, rate: 0.15 },
    { limit: 6800000, rate: 0.18 },
    { limit: 4000000, rate: 0.21 },
    { limit: 12000000, rate: 0.23 },
    { limit: Infinity, rate: 0.25 }
];

let selectedFile = null;
let capturedCameraBlob = null;
let cameraStream = null;
let processedData = [];

function money(v) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2
    }).format(Number(v) || 0);
}

function numberValue(v) {
    if (v === null || v === undefined || v === "") return 0;

    if (typeof v === "number") {
        return Number.isFinite(v) ? v : 0;
    }

    const n = parseFloat(
        String(v)
            .replace(/₦/g, "")
            .replace(/NGN/gi, "")
            .replace(/,/g, "")
            .replace(/\s/g, "")
    );

    return Number.isFinite(n) ? n : 0;
}

function normalizeText(t) {
    return String(t || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n")
        .trim();
}

function escapeHTML(v) {
    return String(v ?? "")
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

    const gross = numberValue(monthlyGross);

    const annualGross = gross * 12;

    const annualDeductions =
        (
            numberValue(pension) +
            numberValue(nhf) +
            numberValue(nhis) +
            numberValue(rentReliefMonthly)
        ) * 12;

    let taxableIncome =
        annualGross -
        annualDeductions -
        TAX_FREE;

    taxableIncome = Math.max(0, taxableIncome);

    let remaining = taxableIncome;
    let annualTax = 0;

    for (const band of TAX_BANDS) {

        if (remaining <= 0) {
            break;
        }

        const amountInBand =
            Math.min(
                remaining,
                band.limit
            );

        annualTax +=
            amountInBand * band.rate;

        remaining -=
            amountInBand;
    }

    return annualTax / 12;
}


/* =========================================================
   RENT RELIEF
   ========================================================= */

function calculateRentRelief(
    annualRent,
    employerHousing
) {

    const rent =
        numberValue(annualRent);

    if (
        employerHousing ||
        rent <= 0
    ) {
        return 0;
    }

    return Math.min(
        rent * 0.20,
        500000
    );
}


/* =========================================================
   TESSERACT OCR
   ========================================================= */

async function initializeOCR() {

    /*
     * We deliberately DO NOT use:
     *
     * worker.load()
     * worker.loadLanguage()
     * worker.initialize()
     *
     * This avoids the Tesseract version
     * compatibility problem.
     */

    if (!window.Tesseract) {

        throw new Error(
            "Tesseract OCR library could not be loaded. " +
            "Check your internet connection and reload the page."
        );
    }

    return true;
}


async function recognizeImage(image) {

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
                logger: function(message) {

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
                                (message.progress || 0) * 100
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

    if (
        !result ||
        !result.data
    ) {

        throw new Error(
            "OCR returned no result."
        );
    }

    return normalizeText(
        result.data.text || ""
    );
}


/* =========================================================
   IMAGE PREPROCESSING
   ========================================================= */

function preprocessImage(
    source,
    mode = "normal"
) {

    const scale = 2;

    const canvas =
        document.createElement(
            "canvas"
        );

    canvas.width =
        source.width * scale;

    canvas.height =
        source.height * scale;

    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently: true
            }
        );

    ctx.drawImage(
        source,
        0,
        0,
        canvas.width,
        canvas.height
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
            (0.299 * data[i]) +
            (0.587 * data[i + 1]) +
            (0.114 * data[i + 2]);

        gray =
            ((gray - 128) * 1.35) +
            128;

        gray =
            Math.max(
                0,
                Math.min(
                    255,
                    gray
                )
            );

        if (
            mode === "threshold"
        ) {

            gray =
                gray > 165
                    ? 255
                    : 0;
        }

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
   SHARPEN
   ========================================================= */

function sharpenCanvas(
    canvas
) {

    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently: true
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

    const copy =
        new Uint8ClampedArray(
            data
        );

    const width =
        canvas.width;

    const height =
        canvas.height;

    for (
        let y = 1;
        y < height - 1;
        y++
    ) {

        for (
            let x = 1;
            x < width - 1;
            x++
        ) {

            const index =
                (y * width + x) * 4;

            const top =
                ((y - 1) * width + x) * 4;

            const bottom =
                ((y + 1) * width + x) * 4;

            const left =
                (y * width + x - 1) * 4;

            const right =
                (y * width + x + 1) * 4;

            const value =
                (5 * copy[index]) -
                copy[top] -
                copy[bottom] -
                copy[left] -
                copy[right];

            const finalValue =
                Math.max(
                    0,
                    Math.min(
                        255,
                        value
                    )
                );

            data[index] =
                finalValue;

            data[index + 1] =
                finalValue;

            data[index + 2] =
                finalValue;
        }
    }

    ctx.putImageData(
        image,
        0,
        0
    );

    return canvas;
}


/* =========================================================
   CANVAS TO BLOB
   ========================================================= */

function canvasToBlob(
    canvas
) {

    return new Promise(
        function(resolve, reject) {

            canvas.toBlob(
                function(blob) {

                    if (!blob) {

                        reject(
                            new Error(
                                "Could not create image."
                            )
                        );

                        return;
                    }

                    resolve(blob);
                },
                "image/jpeg",
                0.95
            );
        }
    );
}


/* =========================================================
   OCR VARIANTS
   ========================================================= */

function containsImportantPayslipWords(
    text
) {

    const upper =
        String(text || "")
            .toUpperCase();

    const words = [
        "GROSS",
        "SALARY",
        "PENSION",
        "NHF",
        "NHIS",
        "ALLOWANCE",
        "EARNINGS",
        "DEDUCTION"
    ];

    let matches = 0;

    for (
        const word of words
    ) {

        if (
            upper.includes(word)
        ) {

            matches++;
        }
    }

    return matches >= 2;
}


async function performOCR(
    sourceCanvas
) {

    const normal =
        sharpenCanvas(
            preprocessImage(
                sourceCanvas,
                "normal"
            )
        );

    let text =
        await recognizeImage(
            await canvasToBlob(
                normal
            )
        );

    /*
     * If normal OCR is weak,
     * try threshold OCR.
     */

    if (
        text.length < 80 ||
        !containsImportantPayslipWords(
            text
        )
    ) {

        const threshold =
            preprocessImage(
                sourceCanvas,
                "threshold"
            );

        const secondText =
            await recognizeImage(
                await canvasToBlob(
                    threshold
                )
            );

        if (
            secondText.length >
            text.length
        ) {

            text =
                secondText;
        }
    }

    return text;
}
/* =========================================================
   MONEY EXTRACTION
   ========================================================= */

function extractMoney(
    text
) {

    const matches =
        String(text || "")
            .replace(/₦/g, " ")
            .replace(/NGN/gi, " ")
            .match(
                /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b/g
            ) || [];

    return matches
        .map(
            function(value) {
                return numberValue(
                    value
                );
            }
        )
        .filter(
            function(value) {
                return value > 0;
            }
        );
}


/* =========================================================
   FIND VALUE NEAR LABEL
   ========================================================= */

function findValueNearLabel(
    text,
    labels
) {

    const lines =
        String(text || "")
            .split("\n")
            .map(
                function(line) {
                    return line.trim();
                }
            )
            .filter(Boolean);

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const upper =
            lines[i].toUpperCase();

        const matched =
            labels.some(
                function(label) {
                    return upper.includes(
                        label
                    );
                }
            );

        if (!matched) {
            continue;
        }

        /*
         * Number on same line.
         */

        const sameLine =
            extractMoney(
                lines[i]
            );

        if (
            sameLine.length
        ) {

            return sameLine[
                sameLine.length - 1
            ];
        }

        /*
         * Check next two lines.
         */

        for (
            let j = i + 1;
            j <= i + 2 &&
            j < lines.length;
            j++
        ) {

            const nearby =
                extractMoney(
                    lines[j]
                );

            if (
                nearby.length
            ) {

                return nearby[0];
            }
        }
    }

    return 0;
}


/* =========================================================
   EXTRACT PAYSLIP DATA
   ========================================================= */

function extractPayslipData(
    text
) {

    const upper =
        String(text || "")
            .toUpperCase();

    let gross =
        findValueNearLabel(
            upper,
            [
                "GROSS SALARY",
                "GROSS PAY",
                "GROSS",
                "TOTAL EARNINGS",
                "TOTAL PAY",
                "GROSS INCOME",
                "TOTAL GROSS"
            ]
        );

    if (!gross) {

        gross =
            findValueNearLabel(
                upper,
                [
                    "TOTAL SALARY",
                    "TOTAL REMUNERATION",
                    "TAXABLE GROSS"
                ]
            );
    }

    const pension =
        findValueNearLabel(
            upper,
            [
                "PENSION DEDUCTION",
                "PENSION",
                "PEN"
            ]
        );

    const nhf =
        findValueNearLabel(
            upper,
            [
                "NATIONAL HOUSING FUND",
                "NHF"
            ]
        );

    const nhis =
        findValueNearLabel(
            upper,
            [
                "NATIONAL HEALTH INSURANCE",
                "NHIS",
                "HEALTH INSURANCE"
            ]
        );

    return {
        gross: gross,
        pension: pension,
        nhf: nhf,
        nhis: nhis
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

    if (!data.gross) {

        result.innerHTML = `

            <div class="error">

                <strong>
                Could not confidently identify Gross Salary.
                </strong>

                <br><br>

                Please make sure:

                <ul>
                    <li>The payslip is clear.</li>
                    <li>The whole payslip is inside the camera frame.</li>
                    <li>There is enough light.</li>
                    <li>The camera is focused on the text.</li>
                </ul>

            </div>

            <details>

                <summary>
                Show OCR text
                </summary>

                <pre style="
                    white-space:pre-wrap;
                    margin-top:10px;
                ">${escapeHTML(
                    ocrText
                )}</pre>

            </details>
        `;

        return;
    }

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

    const rentReliefAnnual =
        calculateRentRelief(
            rent,
            employerHousing
        );

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
                <th>Item</th>
                <th>Amount</th>
            </tr>

            <tr>
                <td>Gross Salary</td>
                <td>${money(data.gross)}</td>
            </tr>

            <tr>
                <td>Pension</td>
                <td>${money(data.pension)}</td>
            </tr>

            <tr>
                <td>NHF</td>
                <td>${money(data.nhf)}</td>
            </tr>

            <tr>
                <td>NHIS</td>
                <td>${money(data.nhis)}</td>
            </tr>

            <tr>
                <td>Rent Relief Applied</td>
                <td>${money(
                    rentReliefAnnual
                )}</td>
            </tr>

            <tr>

                <th>
                PAYE Under Current Tax Reform
                </th>

                <th>
                ${money(paye)}
                </th>

            </tr>

        </table>

        <details style="margin-top:15px;">

            <summary>
            Show extracted information
            </summary>

            <pre style="
                white-space:pre-wrap;
                margin-top:10px;
            ">${escapeHTML(
                ocrText
            )}</pre>

        </details>
    `;
}


/* =========================================================
   IMAGE FILE TO CANVAS
   ========================================================= */

function imageFileToCanvas(
    file
) {

    return new Promise(
        function(resolve, reject) {

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
   PROCESS IMAGE FILE
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

        text: text,

        data:
            extractPayslipData(
                text
            )
    };
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
                input &&
                input.files &&
                input.files.length
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

        /*
         * PDF
         */

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

        /*
         * Image
         */

        if (loading) {

            loading.textContent =
                "Enhancing image for OCR...";
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
            loading.textContent = "";
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
   PDF PROCESSING
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
                    data: buffer
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
                    scale: 2.5
                });

            const canvas =
                document.createElement(
                    "canvas"
                );

            canvas.width =
                viewport.width;

            canvas.height =
                viewport.height;

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
            loading.textContent = "";
        }
    }
}
/* =========================================================
   GALLERY INPUT
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function() {

        const galleryInput =
            document.getElementById(
                "galleryInput"
            );

        if (galleryInput) {

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
   CAMERA SCANNER
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
                "Camera access requires HTTPS. Please open the website using https://."
            );
        }

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            throw new Error(
                "This browser does not support direct camera access."
            );
        }

        modal.classList.add(
            "active"
        );

        if (status) {

            status.style.display =
                "block";

            status.textContent =
                "Starting camera...";
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
                                1920
                        },

                        height: {
                            ideal:
                                1080
                        },

                        frameRate: {
                            ideal: 30,
                            max: 30
                        }
                    },

                    audio: false
                });

        video.srcObject =
            cameraStream;

        await video.play();

        if (status) {

            status.textContent =
                "Position the payslip inside the box";

            setTimeout(
                function() {

                    status.style.display =
                        "none";

                },
                2500
            );
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

        if (status) {
            status.style.display =
                "none";
        }

        alert(
            error.message ||
            "Unable to access camera."
        );
    }
}


/* =========================================================
   CAPTURE CAMERA IMAGE
   ========================================================= */

async function capturePayslipImage() {

    const video =
        document.getElementById(
            "cameraVideo"
        );

    const canvas =
        document.getElementById(
            "cameraCanvas"
        );

    const status =
        document.getElementById(
            "cameraStatus"
        );

    if (
        !video ||
        !canvas
    ) {

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
                "Capturing payslip...";
        }

        /*
         * Capture actual camera resolution.
         */

        canvas.width =
            video.videoWidth;

        canvas.height =
            video.videoHeight;

        const context =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently:
                        true
                }
            );

        context.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        capturedCameraBlob =
            await canvasToBlob(
                canvas
            );

        selectedFile =
            new File(
                [
                    capturedCameraBlob
                ],
                "payslip-camera.jpg",
                {
                    type:
                        "image/jpeg"
                }
            );

        /*
         * Stop camera immediately.
         */

        stopCameraStream();

        const modal =
            document.getElementById(
                "cameraModal"
            );

        if (modal) {

            modal.classList.remove(
                "active"
            );
        }

        const loading =
            document.getElementById(
                "loading"
            );

        const result =
            document.getElementById(
                "result"
            );

        if (loading) {

            loading.textContent =
                "Enhancing camera image and reading payslip...";
        }

        if (result) {

            result.innerHTML = `

                <div class="warning">

                    📷 Camera image captured.

                    <br>

                    Enhancing image and running OCR...

                </div>
            `;
        }

        /*
         * Use exactly the same OCR
         * function used by PDF and
         * uploaded images.
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

        const result =
            document.getElementById(
                "result"
            );

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

    const modal =
        document.getElementById(
            "cameraModal"
        );

    if (modal) {

        modal.classList.remove(
            "active"
        );
    }
}


/* =========================================================
   STOP CAMERA
   ========================================================= */

function stopCameraStream() {

    if (cameraStream) {

        cameraStream
            .getTracks()
            .forEach(
                function(track) {

                    track.stop();
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

        video.srcObject =
            null;
    }
}


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
        )?.checked || false;

    const result =
        document.getElementById(
            "result"
        );

    const relief =
        calculateRentRelief(
            rent,
            employerHousing
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

    result.innerHTML = `

        <div class="success">

            <strong>
            Rent relief calculated successfully.
            </strong>

            <br><br>

            Annual Rent:
            <strong>
            ${money(rent)}
            </strong>

            <br>

            Rent Relief Applied:
            <strong>
            ${money(relief)}
            </strong>

            <br><br>

            Monthly equivalent used for PAYE:
            <strong>
            ${money(relief / 12)}
            </strong>

        </div>
    `;
}


/* =========================================================
   EXCEL PAYROLL
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
        !input ||
        !input.files ||
        !input.files.length
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
                        row["Employee Name"] ||
                        row["Name"] ||
                        "";

                    const gross =
                        numberValue(
                            row["Gross Salary"]
                        );

                    const pension =
                        numberValue(
                            row["Pension"]
                        );

                    const nhf =
                        numberValue(
                            row["NHF"]
                        );

                    const nhis =
                        numberValue(
                            row["NHIS"]
                        );

                    const rent =
                        numberValue(
                            row["Rent"]
                        );

                    const housingText =
                        String(
                            row[
                                "Employer Housing"
                            ] || ""
                        )
                        .trim()
                        .toLowerCase();

                    const employerHousing =
                        housingText === "yes" ||
                        housingText === "y" ||
                        housingText === "true" ||
                        housingText === "1";

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
                            rentReliefAnnual / 12
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
                                paye.toFixed(2)
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
   DISPLAY EXCEL PREVIEW
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
                    money(value);
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
   PAGE VISIBILITY / CLEANUP
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
   END
   ========================================================= */
