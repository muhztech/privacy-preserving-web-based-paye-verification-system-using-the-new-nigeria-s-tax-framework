/* =========================================================
   NIGERIA PAYE COMPUTATION SYSTEM
   Camera OCR + Payslip OCR + Excel Payroll
   Built by Mudris Tech Solution
   ========================================================= */


/* =========================================================
   TAX CONFIGURATION
   Nigeria Tax Act / Current Tax Reform
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

let tesseractWorker = null;
let workerReady = false;

let processedData = [];


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function money(value) {

    const number = Number(value) || 0;

    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2
    }).format(number);
}


function numberValue(value) {

    if (value === null || value === undefined) {
        return 0;
    }

    if (typeof value === "number") {
        return isNaN(value) ? 0 : value;
    }

    let text = String(value)
        .replace(/₦/gi, "")
        .replace(/NGN/gi, "")
        .replace(/,/g, "")
        .replace(/\s/g, "")
        .trim();

    const number = parseFloat(text);

    return isNaN(number) ? 0 : number;
}


function normalizeText(text) {

    return String(text || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n")
        .trim();

}


/* =========================================================
   PAYE CALCULATION
   ========================================================= */

function computePAYE(
    monthlyGross,
    pension = 0,
    nhf = 0,
    nhis = 0,
    rentRelief = 0
) {

    monthlyGross = numberValue(monthlyGross);
    pension = numberValue(pension);
    nhf = numberValue(nhf);
    nhis = numberValue(nhis);
    rentRelief = numberValue(rentRelief);

    const annualGross = monthlyGross * 12;

    const annualPension = pension * 12;
    const annualNHF = nhf * 12;
    const annualNHIS = nhis * 12;

    const annualRentRelief = rentRelief * 12;

    let taxableIncome =
        annualGross
        - annualPension
        - annualNHF
        - annualNHIS
        - annualRentRelief
        - TAX_FREE;

    taxableIncome = Math.max(0, taxableIncome);

    let remaining = taxableIncome;
    let annualTax = 0;

    for (const band of TAX_BANDS) {

        if (remaining <= 0) {
            break;
        }

        const amountInBand = Math.min(
            remaining,
            band.limit
        );

        annualTax += amountInBand * band.rate;

        remaining -= amountInBand;
    }

    return annualTax / 12;
}


/* =========================================================
   TESSERACT WORKER
   ========================================================= */

async function initializeOCR() {

    if (workerReady && tesseractWorker) {
        return tesseractWorker;
    }

    if (!window.Tesseract) {
        throw new Error(
            "Tesseract OCR library could not be loaded."
        );
    }

    const loading = document.getElementById("loading");

    if (loading) {
        loading.textContent = "Preparing OCR engine...";
    }

    tesseractWorker = Tesseract.createWorker({

        logger: function (message) {

            if (!message) return;

            if (message.status === "recognizing text") {

                const progress =
                    Math.round((message.progress || 0) * 100);

                if (loading) {
                    loading.textContent =
                        `Reading payslip... ${progress}%`;
                }

            } else if (message.status) {

                if (loading) {
                    loading.textContent =
                        `OCR: ${message.status}`;
                }

            }

        }

    });

    await tesseractWorker.load();

    await tesseractWorker.loadLanguage("eng");

    await tesseractWorker.initialize("eng");

    await tesseractWorker.setParameters({

        tessedit_pageseg_mode: "6",

        preserve_interword_spaces: "1"

    });

    workerReady = true;

    return tesseractWorker;
}


/* =========================================================
   IMAGE PREPROCESSING
   ========================================================= */

/*
   The camera image is processed before OCR.

   Steps:
   1. Upscale
   2. Grayscale
   3. Contrast enhancement
   4. Sharpening
   5. Thresholding

   This is particularly useful for mobile camera images.
*/


function preprocessImage(sourceCanvas, mode = "normal") {

    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;

    const scale = 2;

    const canvas = document.createElement("canvas");

    canvas.width = sourceWidth * scale;
    canvas.height = sourceHeight * scale;

    const ctx = canvas.getContext("2d", {
        willReadFrequently: true
    });

    ctx.drawImage(
        sourceCanvas,
        0,
        0,
        canvas.width,
        canvas.height
    );

    const imageData =
        ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );

    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {

        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        /*
          Grayscale using luminance.
        */

        let gray =
            (0.299 * r) +
            (0.587 * g) +
            (0.114 * b);


        /*
          Contrast enhancement.
        */

        gray =
            ((gray - 128) * 1.35) + 128;

        gray =
            Math.max(
                0,
                Math.min(255, gray)
            );


        /*
          Optional threshold mode.
        */

        if (mode === "threshold") {

            gray =
                gray > 165
                    ? 255
                    : 0;

        }


        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;

    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
}


/* =========================================================
   SHARPEN IMAGE
   ========================================================= */

function sharpenCanvas(canvas) {

    const ctx =
        canvas.getContext("2d", {
            willReadFrequently: true
        });

    const imageData =
        ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );

    const data = imageData.data;

    const width = canvas.width;
    const height = canvas.height;

    const copy =
        new Uint8ClampedArray(data);

    /*
       Simple sharpening kernel:
       
          0  -1   0
         -1   5  -1
          0  -1   0
    */

    for (let y = 1; y < height - 1; y++) {

        for (let x = 1; x < width - 1; x++) {

            const index =
                (y * width + x) * 4;

            const top =
                ((y - 1) * width + x) * 4;

            const bottom =
                ((y + 1) * width + x) * 4;

            const left =
                (y * width + (x - 1)) * 4;

            const right =
                (y * width + (x + 1)) * 4;


            const value =
                (5 * copy[index])
                - copy[top]
                - copy[bottom]
                - copy[left]
                - copy[right];


            const finalValue =
                Math.max(
                    0,
                    Math.min(255, value)
                );


            data[index] = finalValue;
            data[index + 1] = finalValue;
            data[index + 2] = finalValue;

        }
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
}


/* =========================================================
   CREATE OCR IMAGE VARIANTS
   ========================================================= */

function createOCRVariants(sourceCanvas) {

    const normal =
        preprocessImage(
            sourceCanvas,
            "normal"
        );

    const sharpened =
        sharpenCanvas(normal);

    const threshold =
        preprocessImage(
            sourceCanvas,
            "threshold"
        );

    return {
        normal: sharpened,
        threshold: threshold
    };
}


/* =========================================================
   CANVAS TO BLOB
   ========================================================= */

function canvasToBlob(canvas) {

    return new Promise((resolve, reject) => {

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

    });

}


/* =========================================================
   OCR IMAGE
   ========================================================= */

async function recognizeImage(image) {

    const worker =
        await initializeOCR();

    const result =
        await worker.recognize(image);

    return normalizeText(
        result.data.text
    );
}


/* =========================================================
   OCR WITH TWO IMAGE VERSIONS
   ========================================================= */

async function performOCR(sourceCanvas) {

    const variants =
        createOCRVariants(sourceCanvas);


    const normalBlob =
        await canvasToBlob(
            variants.normal
        );


    let text =
        await recognizeImage(
            normalBlob
        );


    /*
       If the first OCR result is weak,
       run the threshold version too.
    */

    if (
        text.length < 80 ||
        !containsImportantPayslipWords(text)
    ) {

        const thresholdBlob =
            await canvasToBlob(
                variants.threshold
            );


        const secondText =
            await recognizeImage(
                thresholdBlob
            );


        if (
            secondText.length >
            text.length
        ) {

            text = secondText;

        }

    }


    return text;
}


/* =========================================================
   CHECK OCR RESULT
   ========================================================= */

function containsImportantPayslipWords(text) {

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
        "PAYE",
        "EARNINGS",
        "DEDUCTION"

    ];


    let matches = 0;


    for (const word of words) {

        if (upper.includes(word)) {
            matches++;
        }

    }


    return matches >= 2;
}


/* =========================================================
   MONEY EXTRACTION
   ========================================================= */

function extractMoney(text) {

    if (!text) {
        return [];
    }


    const cleaned =
        String(text)
            .replace(/₦/g, " ")
            .replace(/NGN/gi, " ")
            .replace(/\r/g, "\n");


    const matches =
        cleaned.match(
            /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b/g
        );


    if (!matches) {
        return [];
    }


    return matches
        .map(value => {

            const number =
                numberValue(value);

            return {

                raw: value,

                value: number

            };

        })
        .filter(item => item.value > 0);

}


/* =========================================================
   FIND VALUE NEAR LABEL
   ========================================================= */

function findValueNearLabel(
    text,
    labelPatterns
) {

    const lines =
        String(text || "")
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);


    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i];


        const upper =
            line.toUpperCase();


        let matched = false;


        for (const pattern of labelPatterns) {

            if (
                upper.includes(
                    pattern.toUpperCase()
                )
            ) {

                matched = true;
                break;

            }

        }


        if (!matched) {
            continue;
        }


        /*
          First look for a number on the same line.
        */

        const sameLine =
            extractMoney(line);


        if (sameLine.length > 0) {

            return sameLine[
                sameLine.length - 1
            ].value;

        }


        /*
          If no number is on the same line,
          check the next two lines.
        */

        for (
            let j = i + 1;
            j <= i + 2 && j < lines.length;
            j++
        ) {

            const nearby =
                extractMoney(
                    lines[j]
                );


            if (nearby.length > 0) {

                return nearby[0].value;

            }

        }

    }


    return 0;
}


/* =========================================================
   EXTRACT PAYSLIP DATA
   ========================================================= */

function extractPayslipData(text) {

    const upper =
        String(text || "")
            .toUpperCase();


    /*
       Gross salary
    */

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


    /*
       Pension
    */

    let pension =
        findValueNearLabel(
            upper,
            [
                "PENSION",
                "PEN",
                "PENSION DEDUCTION"
            ]
        );


    /*
       NHF
    */

    let nhf =
        findValueNearLabel(
            upper,
            [
                "NHF",
                "NATIONAL HOUSING FUND"
            ]
        );


    /*
       NHIS
    */

    let nhis =
        findValueNearLabel(
            upper,
            [
                "NHIS",
                "NATIONAL HEALTH INSURANCE",
                "HEALTH INSURANCE"
            ]
        );


    /*
       Some payslips use "Basic Salary"
       instead of Gross Salary.

       We don't immediately use it as gross,
       because gross is preferable.
    */

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


    return {

        gross: gross,

        pension: pension,

        nhf: nhf,

        nhis: nhis

    };

}


/* =========================================================
   DISPLAY OCR RESULT
   ========================================================= */

function displayPayslipResult(
    data,
    ocrText = ""
) {

    const result =
        document.getElementById("result");


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
                ">${escapeHTML(ocrText)}</pre>

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


    const employerHouse =
        document.getElementById(
            "employerHouse"
        )?.checked || false;


    let rentReliefAnnual = 0;


    if (
        rent > 0 &&
        !employerHouse
    ) {

        rentReliefAnnual =
            Math.min(
                rent * 0.20,
                500000
            );

    }


    const rentReliefMonthly =
        rentReliefAnnual / 12;


    const paye =
        computePAYE(
            data.gross,
            data.pension,
            data.nhf,
            data.nhis,
            rentReliefMonthly
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
                <td>${money(rentReliefAnnual)}</td>
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
            ">${escapeHTML(ocrText)}</pre>

        </details>

    `;

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHTML(value) {

    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* =========================================================
   CREATE CANVAS FROM IMAGE FILE
   ========================================================= */

function imageFileToCanvas(file) {

    return new Promise((resolve, reject) => {

        const image =
            new Image();

        const url =
            URL.createObjectURL(file);


        image.onload = function() {

            const canvas =
                document.createElement("canvas");


            canvas.width =
                image.naturalWidth;

            canvas.height =
                image.naturalHeight;


            const ctx =
                canvas.getContext("2d");


            ctx.drawImage(
                image,
                0,
                0,
                canvas.width,
                canvas.height
            );


            URL.revokeObjectURL(url);

            resolve(canvas);

        };


        image.onerror = function() {

            URL.revokeObjectURL(url);

            reject(
                new Error(
                    "Could not read image."
                )
            );

        };


        image.src = url;

    });

}


/* =========================================================
   PROCESS IMAGE FILE
   ========================================================= */

async function processImageFile(file) {

    if (!file) {

        throw new Error(
            "No image was selected."
        );

    }


    const canvas =
        await imageFileToCanvas(file);


    const ocrText =
        await performOCR(canvas);


    return {

        text: ocrText,

        data:
            extractPayslipData(
                ocrText
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


        /*
          If the user selected a gallery file.
        */

        if (!file) {

            const input =
                document.getElementById(
                    "galleryInput"
                );


            if (
                input &&
                input.files &&
                input.files.length > 0
            ) {

                file =
                    input.files[0];

            }

        }


        /*
          If a camera capture exists,
          use that.
        */

        if (
            capturedCameraBlob &&
            !file
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
          PDF handling.
        */

        if (
            file.type === "application/pdf" ||
            file.name.toLowerCase().endsWith(".pdf")
        ) {

            await processPDF(file);

            return;

        }


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
   PDF PROCESSING
   ========================================================= */

async function processPDF(file) {

    const loading =
        document.getElementById(
            "loading"
        );

    const result =
        document.getElementById(
            "result"
        );


    try {

        if (!window.pdfjsLib) {

            throw new Error(
                "PDF reader could not be loaded."
            );

        }


        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";


        const arrayBuffer =
            await file.arrayBuffer();


        const pdf =
            await pdfjsLib.getDocument({
                data: arrayBuffer
            }).promise;


        let combinedText = "";


        for (
            let pageNumber = 1;
            pageNumber <= pdf.numPages;
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

                    PDF processing failed.

                    <br><br>

                    ${escapeHTML(
                        error.message
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
                        this.files.length > 0
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


    if (!modal || !video) {

        alert(
            "Camera interface could not be loaded."
        );

        return;

    }


    try {

        /*
          Camera must be accessed through HTTPS
          or localhost.
        */

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


        /*
          Rear camera with high resolution.
        */

        cameraStream =
            await navigator.mediaDevices.getUserMedia({

                video: {

                    facingMode: {
                        ideal: "environment"
                    },

                    width: {
                        ideal: 1920
                    },

                    height: {
                        ideal: 1080
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
   CAPTURE PAYSLIP FROM LIVE CAMERA
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
          Use the actual camera resolution.
        */

        canvas.width =
            video.videoWidth;

        canvas.height =
            video.videoHeight;


        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently: true
                }
            );


        /*
          Draw the high-resolution camera frame.
        */

        ctx.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );


        /*
          Convert directly to JPEG.
        */

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
          Stop camera immediately after capture.
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
          Run OCR immediately.
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
            "Camera capture error:",
            error
        );


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


        alert(
            error.message ||
            "Unable to process camera image."
        );

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
   STOP CAMERA STREAM
   ========================================================= */

function stopCameraStream() {

    if (!cameraStream) {
        return;
    }


    cameraStream
        .getTracks()
        .forEach(
            function(track) {

                track.stop();

            }
        );


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

    const rentInput =
        document.getElementById(
            "rentAmount"
        );


    const employerHouse =
        document.getElementById(
            "employerHouse"
        );


    const rentCheck =
        document.getElementById(
            "rentCheck"
        );


    const result =
        document.getElementById(
            "result"
        );


    const rent =
        numberValue(
            rentInput?.value
        );


    const housing =
        employerHouse?.checked ||
        false;


    /*
      Employer-provided accommodation
      means no rent relief.
    */

    if (housing) {

        if (rentCheck) {
            rentCheck.checked = false;
        }


        if (result) {

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

        }

        return;

    }


    if (rent <= 0) {

        if (result) {

            result.innerHTML = `

                <div class="warning">

                    No rent amount was entered.

                    <br><br>

                    Rent relief is ₦0.

                </div>

            `;

        }

        return;

    }


    /*
      Current rule:
      20% of annual rent, maximum ₦500,000.
    */

    const relief =
        Math.min(
            rent * 0.20,
            500000
        );


    if (result) {

        result.innerHTML = `

            <div class="success">

                <strong>
                Rent relief calculated successfully.
                </strong>

                <br><br>

                Annual Rent:
                <strong>${money(rent)}</strong>

                <br>

                Rent Relief Applied:
                <strong>${money(relief)}</strong>

                <br><br>

                Monthly equivalent used for PAYE:
                <strong>${money(relief / 12)}</strong>

            </div>

        `;

    }

}


/* =========================================================
   EXCEL PAYROLL PROCESSING
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


        const arrayBuffer =
            await file.arrayBuffer();


        const workbook =
            XLSX.read(
                arrayBuffer,
                {
                    type: "array"
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
                    defval: ""
                }
            );


        if (!rows.length) {

            throw new Error(
                "The Excel file contains no payroll records."
            );

        }


        processedData = [];


        for (
            const row of rows
        ) {

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


            const employerHousingValue =
                row["Employer Housing"];


            const employerHousing =
                String(
                    employerHousingValue ||
                    ""
                )
                    .trim()
                    .toLowerCase();


            const hasEmployerHousing =
                employerHousing === "yes" ||
                employerHousing === "y" ||
                employerHousing === "true" ||
                employerHousing === "1";


            /*
              Rent > 0 automatically means
              rent has been declared.

              No Renting column is required.
            */

            let rentReliefAnnual = 0;


            if (
                rent > 0 &&
                !hasEmployerHousing
            ) {

                rentReliefAnnual =
                    Math.min(
                        rent * 0.20,
                        500000
                    );

            }


            /*
              Monthly relief is used internally
              for monthly PAYE calculation.
            */

            const rentReliefMonthly =
                rentReliefAnnual / 12;


            const paye =
                computePAYE(
                    gross,
                    pension,
                    nhf,
                    nhis,
                    rentReliefMonthly
                );


            /*
              Reconstruct the row from scratch.

              This deliberately removes:
              - Other Deductions
              - Renting
              - PAYE Deducted
              - Old PAYE comparison fields

              from the output.
            */

            processedData.push({

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
                    hasEmployerHousing
                        ? "Yes"
                        : "No",

                "Rent Relief Applied":
                    rentReliefAnnual,

                "PAYE Under Current Tax Reform":
                    Number(
                        paye.toFixed(2)
                    )

            });

        }


        displayExcelPreview(
            processedData
        );


        if (downloadButton) {

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

function displayExcelPreview(data) {

    const preview =
        document.getElementById(
            "excelPreview"
        );


    if (!preview) {
        return;
    }


    if (!data.length) {

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


    let html =
        "<div style='overflow-x:auto;'><table>";


    html += "<thead><tr>";


    for (
        const column of columns
    ) {

        html +=
            `<th>${escapeHTML(column)}</th>`;

    }


    html += "</tr></thead>";


    html += "<tbody>";


    for (
        const row of data
    ) {

        html += "<tr>";


        for (
            const column of columns
        ) {

            let value =
                row[column];


            if (
                [
                    "Gross Salary",
                    "Pension",
                    "NHF",
                    "NHIS",
                    "Rent",
                    "Rent Relief Applied",
                    "PAYE Under Current Tax Reform"
                ].includes(column)
            ) {

                value =
                    money(value);

            }


            html +=
                `<td>${escapeHTML(value)}</td>`;

        }


        html += "</tr>";

    }


    html += "</tbody></table></div>";


    preview.innerHTML =
        html;

}


/* =========================================================
   DOWNLOAD PROCESSED EXCEL
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
   PAGE VISIBILITY
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


/* =========================================================
   PAGE UNLOAD
   ========================================================= */

window.addEventListener(
    "beforeunload",
    function() {

        stopCameraStream();

    }
);


/* =========================================================
   END
   ========================================================= */
