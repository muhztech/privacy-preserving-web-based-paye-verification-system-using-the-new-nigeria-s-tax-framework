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

function money(value) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

function numberValue(value) {
    if (value === null || value === undefined || value === "") return 0;

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    const n = parseFloat(
        String(value)
            .replace(/₦/g, "")
            .replace(/NGN/gi, "")
            .replace(/N(?=\s*\d)/gi, "")
            .replace(/,/g, "")
            .replace(/\s/g, "")
    );

    return Number.isFinite(n) ? n : 0;
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

function computePAYE(
    monthlyGross,
    pension = 0,
    nhf = 0,
    nhis = 0,
    rentReliefMonthly = 0
) {
    const gross = numberValue(monthlyGross);

    const annualGross = gross * 12;
    const annualPension = numberValue(pension) * 12;
    const annualNHF = numberValue(nhf) * 12;
    const annualNHIS = numberValue(nhis) * 12;
    const annualRentRelief = numberValue(rentReliefMonthly) * 12;

    let taxableIncome =
        annualGross -
        annualPension -
        annualNHF -
        annualNHIS -
        annualRentRelief -
        TAX_FREE;

    taxableIncome = Math.max(0, taxableIncome);

    let remaining = taxableIncome;
    let annualTax = 0;

    for (const band of TAX_BANDS) {
        if (remaining <= 0) break;

        const amount = Math.min(
            remaining,
            band.limit
        );

        annualTax += amount * band.rate;
        remaining -= amount;
    }

    return annualTax / 12;
}

function calculateRentRelief(
    annualRent,
    employerHousing = false
) {
    const rent = numberValue(annualRent);

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
    const rent = numberValue(
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

async function initializeOCR() {
    if (
        !window.Tesseract ||
        typeof Tesseract.recognize !== "function"
    ) {
        throw new Error(
            "Tesseract OCR library could not be loaded. Please reload the page and check your internet connection."
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
                                (message.progress || 0) *
                                100
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
        result?.data?.text || ""
    );
}

function preprocessImage(
    sourceCanvas,
    mode = "normal",
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
                sourceCanvas.width *
                scale
            )
        );

    canvas.height =
        Math.max(
            1,
            Math.round(
                sourceCanvas.height *
                scale
            )
        );

    const ctx =
        canvas.getContext(
            "2d",
            {
                willReadFrequently: true
            }
        );

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

    const data =
        imageData.data;

    for (
        let i = 0;
        i < data.length;
        i += 4
    ) {

        let gray =
            0.299 * data[i] +
            0.587 * data[i + 1] +
            0.114 * data[i + 2];

        if (
            mode === "high"
        ) {

            gray =
                ((gray - 128) * 1.65) +
                128;

        } else {

            gray =
                ((gray - 128) * 1.35) +
                128;
        }

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
                gray > 160
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
        imageData,
        0,
        0
    );

    return canvas;
}

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

    const imageData =
        ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );

    const data =
        imageData.data;

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

            const i =
                (y * width + x) * 4;

            const top =
                ((y - 1) *
                    width +
                    x) *
                4;

            const bottom =
                ((y + 1) *
                    width +
                    x) *
                4;

            const left =
                (y *
                    width +
                    x -
                    1) *
                4;

            const right =
                (y *
                    width +
                    x +
                    1) *
                4;

            const value =
                5 * copy[i] -
                copy[top] -
                copy[bottom] -
                copy[left] -
                copy[right];

            const v =
                Math.max(
                    0,
                    Math.min(
                        255,
                        value
                    )
                );

            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
        }
    }

    ctx.putImageData(
        imageData,
        0,
        0
    );

    return canvas;
}

function canvasToBlob(
    canvas,
    quality = 0.95
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {

            canvas.toBlob(
                blob => {

                    if (!blob) {

                        reject(
                            new Error(
                                "Could not create OCR image."
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

    let score = 0;

    if (
        data.gross > 0
    ) {
        score += 100;
    }

    if (
        data.pension > 0
    ) {
        score += 20;
    }

    if (
        data.nhf > 0
    ) {
        score += 10;
    }

    if (
        data.nhis > 0
    ) {
        score += 10;
    }

    if (
        containsImportantPayslipWords(
            normalized
        )
    ) {
        score += 30;
    }

    score += Math.min(
        normalized.length / 100,
        20
    );

    return score;
}

async function performOCR(
    sourceCanvas
) {
    const variants = [

        sharpenCanvas(
            preprocessImage(
                sourceCanvas,
                "normal",
                2
            )
        ),

        preprocessImage(
            sourceCanvas,
            "high",
            2
        ),

        preprocessImage(
            sourceCanvas,
            "threshold",
            2
        )
    ];

    let bestText = "";
    let bestScore = -1;

    for (
        const variant of variants
    ) {

        const blob =
            await canvasToBlob(
                variant
            );

        const text =
            await recognizeImage(
                blob
            );

        const score =
            scoreOCRText(
                text
            );

        if (
            score > bestScore
        ) {

            bestScore =
                score;

            bestText =
                text;
        }
    }

    return bestText;
}

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
            ) || [];

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
            x =>
                x.value > 0
        );
}

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
            (a, b) =>
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

            const pos =
                upper.indexOf(
                    label.toUpperCase()
                );

            if (
                pos < 0
            ) {
                continue;
            }

            let after =
                line.slice(
                    pos +
                    label.length
                );

            const upperAfter =
                after.toUpperCase();

            let stopAt =
                after.length;

            for (
                const stop of stopLabels
            ) {

                const stopPos =
                    upperAfter.indexOf(
                        stop
                    );

                if (
                    stopPos >= 0 &&
                    stopPos < stopAt
                ) {

                    stopAt =
                        stopPos;
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

                return sameLine[0].value;
            }

            for (
                let j = i + 1;
                j <= i + 2 &&
                j < lines.length;
                j++
            ) {

                const nextUpper =
                    lines[j].toUpperCase();

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
                <th>Item</th>
                <th>Amount</th>
            </tr>

            <tr>
                <td>Gross Salary</td>
                <td>${money(
                    data.gross
                )}</td>
            </tr>

            <tr>
                <td>Pension</td>
                <td>${money(
                    data.pension
                )}</td>
            </tr>

            <tr>
                <td>NHF</td>
                <td>${money(
                    data.nhf
                )}</td>
            </tr>

            <tr>
                <td>NHIS</td>
                <td>${money(
                    data.nhis
                )}</td>
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
            ">${escapeHTML(
                ocrText
            )}</pre>

        </details>
    `;
}

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

        if (!window.pdfjsLib) {

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
                Math.ceil(
                    viewport.width
                );

            canvas.height =
                Math.ceil(
                    viewport.height
                );

            const context =
                canvas.getContext(
                    "2d",
                    {
                        willReadFrequently:
                            true
                    }
                );

            await page.render({
                canvasContext:
                    context,
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

        video.setAttribute(
            "playsinline",
            "true"
        );

        video.setAttribute(
            "autoplay",
            "true"
        );

        await video.play();

        const track =
            cameraStream
                .getVideoTracks()[0];

        if (
            track?.applyConstraints
        ) {

            try {

                await track.applyConstraints({
                    width: {
                        ideal:
                            1920
                    },
                    height: {
                        ideal:
                            1080
                    },
                    advanced: [
                        {
                            focusMode:
                                "continuous"
                        }
                    ]
                });

            } catch (_) {
            }
        }

        if (status) {

            status.textContent =
                "Position the payslip inside the box";

            setTimeout(
                () => {

                    if (status) {

                        status.style.display =
                            "none";
                    }

                },
                3000
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

        alert(
            error.message ||
            "Unable to access camera."
        );
    }
}

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

        canvas.width =
            video.videoWidth;

        canvas.height =
            video.videoHeight;

        const ctx =
            canvas.getContext(
                "2d",
                {
                    willReadFrequently:
                        true
                }
            );

        ctx.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        capturedCameraBlob =
            await canvasToBlob(
                canvas,
                0.97
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

                <details>

                    <summary>
                    Technical information
                    </summary>

                    <pre style="
                        white-space:pre-wrap;
                    ">${escapeHTML(
                        String(
                            error.stack ||
                            ""
                        )
                    )}</pre>

                </details>
            `;
        }
    }
}

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

function stopCameraStream() {

    if (cameraStream) {

        cameraStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
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

        if (!window.XLSX) {

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

    if (!window.XLSX) {

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
