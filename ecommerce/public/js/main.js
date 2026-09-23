// // ==========================================
// // TOAST NOTIFICATION
// // ==========================================

// document.addEventListener("DOMContentLoaded", function () {

//     const toasts = document.querySelectorAll(
//         "#successToast, #errorToast"
//     );


//     toasts.forEach(function (toast) {

//         const progress = toast.querySelector(".toast-progress");

//         const closeButton = toast.querySelector(".toast-close");


//         // ==========================================
//         // START PROGRESS BAR
//         // ==========================================

//         if (progress) {

//             // Force browser to register initial width
//             progress.style.width = "100%";

//             setTimeout(function () {

//                 progress.style.width = "0%";

//             }, 50);
//         }


//         // ==========================================
//         // CLOSE BUTTON
//         // ==========================================

//         if (closeButton) {

//             closeButton.addEventListener(
//                 "click",
//                 function () {

//                     removeToast(toast);

//                 }
//             );
//         }


//         // ==========================================
//         // AUTO CLOSE AFTER 5 SECONDS
//         // ==========================================

//         setTimeout(function () {

//             removeToast(toast);

//         }, 5000);

//     });


// });


// // ==========================================
// // REMOVE TOAST
// // ==========================================

// function removeToast(toast) {

//     if (!toast) {
//         return;
//     }


//     // Prevent duplicate removal
//     if (toast.dataset.removed === "true") {
//         return;
//     }

//     toast.dataset.removed = "true";


//     // Hide
//     toast.style.transition =
//         "opacity 0.3s ease, transform 0.3s ease";

//     toast.style.opacity = "0";

//     toast.style.transform = "translateX(30px)";


//     // Remove from DOM
//     setTimeout(function () {

//         toast.remove();

//     }, 300);

// }

// function closeToast(id) {
//     const toast = document.getElementById(id);

//     if (!toast) {
//         return;
//     }

//     toast.remove();
// }


