// // Initial scores for red and blue
// let scores = { red: 0, blue: 0 };

// // Function to update the score
// function updateScore(player, points) {
//     scores[player] += points;
//     console.log(`${player} scored ${points} points! Total: ${scores[player]}`);
//     // Here, you can add logic to update the scoreboard in your HTML or UI.
// }

// // Detecting swipe action
// function detectSwipe(element, player, clickPoints, swipePoints) {
//     let touchStartX = 0;
//     let touchEndX = 0;

//     // On touch start
//     element.addEventListener('touchstart', (event) => {
//         touchStartX = event.changedTouches[0].screenX;
//     });

//     // On touch end
//     element.addEventListener('touchend', (event) => {
//         touchEndX = event.changedTouches[0].screenX;

//         // Calculate swipe direction
//         if (touchStartX - touchEndX > 50 || touchEndX - touchStartX > 50) {
//             // Swipe detected (left or right)
//             updateScore(player, swipePoints);

//             // Reset element position (optional: Add smooth animation)
//             element.style.transition = "transform 0.2s";
//             element.style.transform = "translateX(0)";
//         }
//     });

//     // On click
//     element.addEventListener('click', () => {
//         updateScore(player, clickPoints);
//     });
// }

// // Adding event listeners to each section
// document.addEventListener('DOMContentLoaded', () => {
//     // Head sections
//     const redHead = document.querySelector('.red:nth-child(1)');
//     const blueHead = document.querySelector('.blue:nth-child(2)');
//     detectSwipe(redHead, 'red', 3, 5);
//     detectSwipe(blueHead, 'blue', 3, 5);

//     // Body sections
//     const redBody = document.querySelector('.red:nth-child(5)');
//     const blueBody = document.querySelector('.blue:nth-child(6)');
//     detectSwipe(redBody, 'red', 2, 4);
//     detectSwipe(blueBody, 'blue', 2, 4);

//     // Punch sections
//     const redPunch = document.querySelector('.red:nth-child(3)');
//     const bluePunch = document.querySelector('.blue:nth-child(4)');
//     detectSwipe(redPunch, 'red', 1, 0); // No swipe logic for punch
//     detectSwipe(bluePunch, 'blue', 1, 0); // No swipe logic for punch
// });
