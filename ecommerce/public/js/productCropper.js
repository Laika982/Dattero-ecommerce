/**
 * Product Image Cropper & Resizer Engine
 * Uses Cropper.js for professional pre-upload image optimization.
 */

class ProductCropper {
    constructor(options = {}) {
        this.options = options;
        this.onFileProcessed = options.onFileProcessed || (() => {});
        this.onQueueComplete = options.onQueueComplete || (() => {});

        // Internal State
        this.cropper = null;
        this.queue = [];
        this.currentIndex = 0;
        this.currentAspect = 1; // Default 1:1 Square for product cards
        this.scaleX = 1;
        this.scaleY = 1;
        this.eventsBound = false;

        this.ensureElements();

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                this.ensureElements();
            });
        }
    }

    ensureElements() {
        if (!this.modal) {
            this.modal = document.getElementById("imageCropperModal");
        }
        if (!this.modal) return false;

        this.targetImage = document.getElementById("cropperTargetImage");
        this.queueBadge = document.getElementById("cropperQueueBadge");
        this.liveDimensions = document.getElementById("cropperLiveDimensions");
        this.applyBtn = document.getElementById("cropperApplyBtn");
        this.applyBtnText = document.getElementById("cropperApplyBtnText");
        this.skipBtn = document.getElementById("cropperSkipBtn");
        this.cancelBtn = document.getElementById("cropperCancelBtn");
        this.discardBtn = document.getElementById("cropperDiscardBtn");

        // Tool buttons
        this.btnRotateLeft = document.getElementById("btnRotateLeft");
        this.btnRotateRight = document.getElementById("btnRotateRight");
        this.btnFlipX = document.getElementById("btnFlipX");
        this.btnFlipY = document.getElementById("btnFlipY");
        this.btnZoomIn = document.getElementById("btnZoomIn");
        this.btnZoomOut = document.getElementById("btnZoomOut");
        this.btnResetCrop = document.getElementById("btnResetCrop");

        // Containers
        this.aspectRatioGroup = document.getElementById("aspectRatioGroup");
        this.resolutionGroup = document.getElementById("resolutionGroup");

        if (!this.eventsBound) {
            this.bindEvents();
            this.eventsBound = true;
        }
        return true;
    }

    bindEvents() {
        if (!this.modal) return;

        // Close / Cancel
        const closeModal = () => this.cancelQueue();
        if (this.cancelBtn) this.cancelBtn.addEventListener("click", closeModal);
        if (this.discardBtn) this.discardBtn.addEventListener("click", closeModal);

        // Close on backdrop click
        this.modal.addEventListener("click", (e) => {
            if (e.target === this.modal) {
                closeModal();
            }
        });

        // Skip current image
        if (this.skipBtn) {
            this.skipBtn.addEventListener("click", () => this.skipCurrentImage());
        }

        // Apply crop
        if (this.applyBtn) {
            this.applyBtn.addEventListener("click", () => this.applyCrop());
        }

        // Transformations
        if (this.btnRotateLeft) {
            this.btnRotateLeft.addEventListener("click", () => {
                if (this.cropper) this.cropper.rotate(-90);
            });
        }
        if (this.btnRotateRight) {
            this.btnRotateRight.addEventListener("click", () => {
                if (this.cropper) this.cropper.rotate(90);
            });
        }
        if (this.btnFlipX) {
            this.btnFlipX.addEventListener("click", () => {
                if (this.cropper) {
                    this.scaleX = -this.scaleX;
                    this.cropper.scaleX(this.scaleX);
                }
            });
        }
        if (this.btnFlipY) {
            this.btnFlipY.addEventListener("click", () => {
                if (this.cropper) {
                    this.scaleY = -this.scaleY;
                    this.cropper.scaleY(this.scaleY);
                }
            });
        }
        if (this.btnZoomIn) {
            this.btnZoomIn.addEventListener("click", () => {
                if (this.cropper) this.cropper.zoom(0.1);
            });
        }
        if (this.btnZoomOut) {
            this.btnZoomOut.addEventListener("click", () => {
                if (this.cropper) this.cropper.zoom(-0.1);
            });
        }
        if (this.btnResetCrop) {
            this.btnResetCrop.addEventListener("click", () => {
                if (this.cropper) {
                    this.scaleX = 1;
                    this.scaleY = 1;
                    this.cropper.reset();
                }
            });
        }

        // Aspect Ratio buttons
        if (this.aspectRatioGroup) {
            this.aspectRatioGroup.addEventListener("click", (e) => {
                const btn = e.target.closest(".aspect-btn");
                if (!btn) return;

                const aspectVal = parseFloat(btn.dataset.aspect);
                this.currentAspect = isNaN(aspectVal) ? NaN : aspectVal;

                // Update active button UI
                this.aspectRatioGroup.querySelectorAll(".aspect-btn").forEach((b) => {
                    b.classList.remove("border-on-surface", "bg-on-surface", "text-surface", "active-aspect");
                    b.classList.add("border-outline-variant/40", "bg-surface-container-lowest", "text-on-surface");
                });

                btn.classList.remove("border-outline-variant/40", "bg-surface-container-lowest", "text-on-surface");
                btn.classList.add("border-on-surface", "bg-on-surface", "text-surface", "active-aspect");

                if (this.cropper) {
                    this.cropper.setAspectRatio(this.currentAspect);
                }
            });
        }

        // Resolution preset highlights
        if (this.resolutionGroup) {
            this.resolutionGroup.addEventListener("change", (e) => {
                if (e.target.name === "targetResolution") {
                    this.resolutionGroup.querySelectorAll("label").forEach((lbl) => {
                        lbl.classList.remove("border-on-surface/40");
                        lbl.classList.add("border-outline-variant/30");
                    });
                    const activeLabel = e.target.closest("label");
                    if (activeLabel) {
                        activeLabel.classList.remove("border-outline-variant/30");
                        activeLabel.classList.add("border-on-surface/40");
                    }
                }
            });
        }
    }

    /**
     * Start cropping queue for newly selected files
     * @param {File[]} files
     */
    startQueue(files) {
        if (!files || files.length === 0) return;

        this.queue = files.map((file) => ({
            file,
            isRecrop: false,
            targetIndex: null
        }));

        this.currentIndex = 0;
        this.openModal();
        this.loadCurrentImage();
    }

    /**
     * Re-crop an existing image in the preview list
     * @param {File} file
     * @param {number} targetIndex
     */
    startSingleRecrop(file, targetIndex) {
        if (!file) return;

        this.queue = [{
            file,
            isRecrop: true,
            targetIndex
        }];

        this.currentIndex = 0;
        this.openModal();
        this.loadCurrentImage();
    }

    openModal() {
        this.ensureElements();
        if (this.modal) {
            this.modal.classList.remove("hidden");
            this.modal.classList.add("flex");
            document.body.style.overflow = "hidden";
        }
    }

    closeModal() {
        this.isProcessing = false;
        if (this.applyBtn) this.applyBtn.disabled = false;
        if (this.modal) {
            this.modal.classList.add("hidden");
            this.modal.classList.remove("flex");
            document.body.style.overflow = "";
        }
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
        this.queue = [];
        this.currentIndex = 0;
    }

    cancelQueue() {
        this.closeModal();
    }

    loadCurrentImage() {
        this.isProcessing = false;
        if (this.applyBtn) this.applyBtn.disabled = false;

        if (this.currentIndex >= this.queue.length) {
            this.closeModal();
            this.onQueueComplete();
            return;
        }

        const item = this.queue[this.currentIndex];

        // Update queue counter
        if (this.queue.length > 1) {
            this.queueBadge.textContent = `Image ${this.currentIndex + 1} of ${this.queue.length}`;
            this.queueBadge.classList.remove("hidden");
        } else {
            this.queueBadge.classList.add("hidden");
        }

        // Update Apply button text
        if (this.currentIndex === this.queue.length - 1) {
            this.applyBtnText.textContent = "Apply & Save";
        } else {
            this.applyBtnText.textContent = "Apply & Next";
        }

        // Reset transforms
        this.scaleX = 1;
        this.scaleY = 1;

        const reader = new FileReader();
        reader.onload = (e) => {
            if (this.cropper) {
                this.cropper.destroy();
                this.cropper = null;
            }

            this.targetImage.src = e.target.result;

            this.cropper = new Cropper(this.targetImage, {
                aspectRatio: this.currentAspect,
                viewMode: 1,
                dragMode: "move",
                autoCropArea: 0.92,
                restore: false,
                guides: true,
                center: true,
                highlight: true,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                crop: (event) => {
                    const width = Math.round(event.detail.width);
                    const height = Math.round(event.detail.height);
                    if (this.liveDimensions) {
                        this.liveDimensions.textContent = `${width} × ${height} px`;
                    }
                }
            });
        };

        reader.readAsDataURL(item.file);
    }

    skipCurrentImage() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const item = this.queue[this.currentIndex];
        this.onFileProcessed(item.file, item.isRecrop, item.targetIndex);

        this.currentIndex++;
        this.loadCurrentImage();
    }

    applyCrop() {
        if (!this.cropper || this.isProcessing) return;
        this.isProcessing = true;
        if (this.applyBtn) this.applyBtn.disabled = true;

        const item = this.queue[this.currentIndex];
        const resRadio = document.querySelector('input[name="targetResolution"]:checked');
        const resValue = resRadio ? resRadio.value : "800";

        let canvasOptions = {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high"
        };

        if (resValue !== "original") {
            const targetDim = parseInt(resValue, 10) || 800;
            const cropData = this.cropper.getData();
            const cropAspect = cropData.width / cropData.height;

            if (Math.abs(cropAspect - 1) < 0.02) {
                // Square
                canvasOptions.width = targetDim;
                canvasOptions.height = targetDim;
            } else if (cropAspect > 1) {
                // Landscape
                canvasOptions.width = targetDim;
                canvasOptions.height = Math.round(targetDim / cropAspect);
            } else {
                // Portrait
                canvasOptions.height = targetDim;
                canvasOptions.width = Math.round(targetDim * cropAspect);
            }
        }

        const croppedCanvas = this.cropper.getCroppedCanvas(canvasOptions);
        if (!croppedCanvas) {
            this.isProcessing = false;
            if (this.applyBtn) this.applyBtn.disabled = false;
            alert("Could not crop the image. Please try again.");
            return;
        }

        // Export as clean, optimized JPEG
        croppedCanvas.toBlob(
            (blob) => {
                if (!blob) {
                    this.isProcessing = false;
                    this.skipCurrentImage();
                    return;
                }

                // Preserve or construct a clean filename
                const baseName = (item.file.name || "product_image").replace(/\.[^/.]+$/, "");
                const newFileName = `${baseName}_cropped.jpg`;
                const processedFile = new File([blob], newFileName, {
                    type: "image/jpeg",
                    lastModified: Date.now()
                });

                this.onFileProcessed(processedFile, item.isRecrop, item.targetIndex);

                this.currentIndex++;
                this.loadCurrentImage();
            },
            "image/jpeg",
            0.92
        );
    }
}

// Export globally for browser use
window.ProductCropper = ProductCropper;
