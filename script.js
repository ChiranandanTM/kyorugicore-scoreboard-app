// Modified script.js (Referee side)
const firebaseConfig = {
    apiKey: "AIzaSyDKGg_bhwCAR6OpywuTiX-HpTXUHboNVhc",
    authDomain: "tkd-kc.firebaseapp.com",
    databaseURL: "https://tkd-kc-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tkd-kc",
    storageBucket: "tkd-kc.appspot.com",
    messagingSenderId: "460367866714",
    appId: "1:460367866714:web:9e68cf9afabe9ccbf7a163"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
let currentRoomId = null;
let refereeId = sessionStorage.getItem('refereeId');
if (!refereeId) {
    refereeId = Math.random().toString(36).substr(2, 8);
    sessionStorage.setItem('refereeId', refereeId);
}

let html5QrCode = null;

// In app/script.js

function submitPoints(player, points, action) {
    if (!currentRoomId) {
        console.warn("No room ID set, cannot submit points");
        return;
    }

    // Get the image source based on the clicked section
    const section = document.querySelector(`.${player}-${action.split('-')[0]}`);
    const imgSrc = section ? section.querySelector('img').src : '';

    const submission = {
        refereeId,
        player,
        points,
        action,
        timestamp: Date.now(),
        image: imgSrc
    };

    const team = player === 'red' ? 'hong' : 'chong';
    const refereeName = sessionStorage.getItem('myName') || refereeId;
    const actionData = {
        image: imgSrc,
        refereeName: refereeName,
        timestamp: Date.now(),
        sourceTeam: player
    };

    // ----------------- CHANGE IS HERE -----------------
    // COMMENT OUT THIS BLOCK. We let the scoreboard's validator handle this.
    /*
    db.ref(`rooms/${currentRoomId}/lastAction/${team}`).set(actionData)
        .catch(err => console.error("Error updating last action:", err));
    */
    // ----------------- END OF CHANGE -----------------

    db.ref(`rooms/${currentRoomId}/submissions`).push(submission)
        .catch(err => console.error("Error submitting points:", err));

    console.log(`Points submitted: ${points} for ${player} (${action}) by referee ${refereeId}`);
}

setInterval(validateSubmissions, 300);

// --- VALIDATOR (leader device) ---
// Runs on the leader referee device and validates submissions in Firebase.
function validateSubmissions() {
    if (!currentRoomId) return;

    db.ref(`rooms/${currentRoomId}`).once('value').then((snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const referees = data.referees || {};
        const refereeIds = Object.keys(referees).sort();
        const leaderId = refereeIds[0];
        const refereeCount = refereeIds.length;
        const now = Date.now();
        const SYNC_WINDOW_MS = 5000; // 5 seconds for multi-referee validation
        const isTimerRunning = !!(data.timer && data.timer.running);

        // Only leader validates and awards points. Non-leaders simply submit.
        if (refereeId !== leaderId) return;

        const submissionsRef = db.ref(`rooms/${currentRoomId}/submissions`);
        submissionsRef.once('value').then(subSnap => {
            const subsRaw = subSnap.val() || {};
            // Convert to array with key so we can remove later
            const subs = Object.entries(subsRaw).map(([key, v]) => ({ key, ...v }));

            if (subs.length === 0) return;

            // Group by identical button: player + points + action
            const groups = {};
            subs.forEach(s => {
                // ignore malformed
                if (!s.player || !s.action || typeof s.points === 'undefined' || !s.refereeId) return;

                const groupKey = `${s.player}__${s.points}__${s.action}`;
                groups[groupKey] = groups[groupKey] || [];
                groups[groupKey].push(s);
            });

            const keysToRemove = new Set();

            Object.entries(groups).forEach(([groupKey, groupSubs]) => {
                // Sort by timestamp
                groupSubs.sort((a, b) => a.timestamp - b.timestamp);
                // For visualization: show lastAction for earliest submit in the group (or each individual update happens on ref side)
                const earliest = groupSubs[0];
                const sampleImage = earliest.image || '';
                const sampleRefName = (data.referees && data.referees[earliest.refereeId] && data.referees[earliest.refereeId].name) || earliest.refereeId || '';

                // Update lastAction in DB so scoreboard shows image + referee name quickly (independent of scoring)
                try {
                    const teamKey = earliest.player === 'red' ? 'hong' : 'chong';
                    db.ref(`rooms/${currentRoomId}/lastAction/${teamKey}`).set({
                        image: sampleImage,
                        refereeName: sampleRefName,
                        timestamp: Date.now(),
                        sourceTeam: earliest.player
                    }).catch(e => console.error(e));
                } catch (e) { console.error(e); }

                // Mark submissions for removal immediately to prevent duplicate updates
                groupSubs.forEach(s => keysToRemove.add(s.key));

                if (!isTimerRunning) {
                    // Timer not running -> do not award points (submissions already marked for removal)
                    return;
                }

                // Determine unique referees in this group and the time spread
                const uniqueRefereeIds = [...new Set(groupSubs.map(s => s.refereeId))];
                const uniqueCount = uniqueRefereeIds.length;
                const earliestTs = groupSubs[0].timestamp;
                const latestTs = groupSubs[groupSubs.length - 1].timestamp;
                const spread = latestTs - earliestTs;

                // Decide award rules:
                // - single referee: immediate award (uniqueCount === 1)
                // - two referees: require both referees pressed same button within SYNC_WINDOW_MS
                // - three or more: require at least 2 referees pressed same button within SYNC_WINDOW_MS
                let shouldAward = false;

                if (refereeCount <= 1) {
                    // If only one referee present anywhere (edge case), award immediately for a single submission
                    if (uniqueCount >= 1) shouldAward = true;
                } else if (refereeCount === 2) {
                    if (uniqueCount === 2 && spread <= SYNC_WINDOW_MS) shouldAward = true;
                } else { // 3 or more referees
                    if (uniqueCount >= 2 && spread <= SYNC_WINDOW_MS) shouldAward = true;
                }

                if (shouldAward) {
                    // award using your existing API (transactionally)
                    awardPoints(groupSubs[0].player, groupSubs[0].points);
                    // Submissions already marked for removal at line 130, no need to mark again
                }
            });

            // Remove awarded submissions
            keysToRemove.forEach(k => {
                if (!k) return;
                db.ref(`rooms/${currentRoomId}/submissions/${k}`).remove().catch(err => console.error("remove error", err));
            });

            // Clean very old submissions (> SYNC_WINDOW_MS * 2) to avoid clutter
            const expiration = SYNC_WINDOW_MS * 2;
            subs.forEach(s => {
                if (now - s.timestamp > expiration) {
                    db.ref(`rooms/${currentRoomId}/submissions/${s.key}`).remove().catch(err => console.error("cleanup error", err));
                }
            });
        }).catch(err => console.error("submissions read error", err));
    }).catch(err => console.error("room read error", err));
}

function awardPoints(player, points) {
    if (!currentRoomId) return;

    const teamKey = player === 'red' ? 'teamA' : 'teamB';
    db.ref(`rooms/${currentRoomId}`).transaction(room => {
        if (!room) return room;

        if (!room[teamKey]) room[teamKey] = { score: 0 };
        room[teamKey].score = (room[teamKey].score || 0) + points;

        const hongScore = room.teamA?.score || 0;
        const chongScore = room.teamB?.score || 0;

        if (Math.abs(hongScore - chongScore) >= 12 && !room.roundDeclared) {
            const winner = hongScore > chongScore ? 'hong' : 'chong';
            const currentRoundsWon = room[winner + 'RoundsWon'] || 0;
            if (room.timer && room.timer.running) {
                room.timer = {
                    ...room.timer,
                    running: false,
                    stoppedTime: {
                        minutes: room.timer.minutes,
                        seconds: room.timer.seconds
                    },
                    playStopSound: true
                };
            }

            room.roundDeclared = true;
            room[winner + 'RoundsWon'] = currentRoundsWon + 1;
            room.redBlinkClass = winner === 'hong' ? 'blink-white' : '';
            room.blueBlinkClass = winner === 'chong' ? 'blink-white' : '';

            if (room[winner + 'RoundsWon'] >= 2) {
                room.matchWinnerDeclared = true;
                room.redBlinkClass = winner === 'hong' ? 'blink-yellow' : '';
                room.blueBlinkClass = winner === 'chong' ? 'blink-yellow' : '';
                room.breakActive = false;
            } else {
                room.breakActive = true;
            }
        }

        return room;
    });
}

// Add to the joinRoom function after setting referee data
function joinRoom() {
    const roomCodeInput = document.getElementById('roomCodeInput');
    const roomCode = roomCodeInput?.value.trim().toUpperCase();
    if (!roomCode) {
        alert("Please enter a room code.");
        console.warn("Room code input is empty");
        return;
    }

    db.ref(`rooms/${roomCode}/referees`).once('value').then((snapshot) => {
        const referees = snapshot.val() || {};
        const refereeCount = Object.keys(referees).length;

        if (refereeCount >= 4 && !referees[refereeId]) {
            alert("Maximum of 4 referees allowed in this room.");
            console.error(`Room ${roomCode} has reached maximum referees`);
            return;
        }

        db.ref(`rooms/${roomCode}`).once('value', (roomSnapshot) => {
            if (roomSnapshot.exists()) {
                currentRoomId = roomCode;
                sessionStorage.setItem('isLoggedIn', 'true');
                sessionStorage.setItem('currentRoomId', currentRoomId);
                document.getElementById('roomEntry').style.display = 'none';
                document.getElementById('scoringUI').style.display = 'block';

                let myName;
                if (referees[refereeId]) {
                    myName = referees[refereeId].name;
                } else {
                    myName = `Referee ${refereeCount + 1}`;
                }

                db.ref(`rooms/${currentRoomId}/referees/${refereeId}`).set({
                    joined: Date.now(),
                    name: myName
                }).then(() => {
                    sessionStorage.setItem('myName', myName);
                }).catch((error) => {
                    console.error("Error setting referee data:", error);
                });
                console.log(`Joined room: ${roomCode}`);

                // Add this line to set up the score listener
                setupScoreListener();

                // Request fullscreen when joining a room
                requestFullscreen();

            } else {
                alert("Invalid room code. Please try again.");
                console.error(`Room code ${roomCode} does not exist`);
            }
        });
    }).catch((error) => {
        console.error("Error checking referees:", error);
        alert("Error joining room. Please try again.");
    });
}

function requestFullscreen() {
    const docEl = document.documentElement;

    if (docEl.requestFullscreen) {
        docEl.requestFullscreen();
    } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
    } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
    }
}

function scanQRCode() {
    const qrReader = document.getElementById('qr-reader');
    if (!qrReader) {
        console.error("QR reader element not found");
        alert("QR reader not available. Please enter the code manually.");
        return;
    }

    qrReader.innerHTML = '';

    qrReader.style.display = 'block';
    qrReader.style.position = 'fixed';
    qrReader.style.top = '50%';
    qrReader.style.left = '50%';
    qrReader.style.transform = 'translate(-50%, -50%)';
    qrReader.style.width = '100%';
    qrReader.style.maxWidth = '300px';
    qrReader.style.height = '300px';
    qrReader.style.backgroundColor = '#000';
    qrReader.style.zIndex = '9999';
    qrReader.style.padding = '10px';
    qrReader.style.borderRadius = '10px';

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.position = 'absolute';
    closeButton.style.right = '10px';
    closeButton.style.top = '10px';
    closeButton.style.backgroundColor = '#ff4444';
    closeButton.style.color = '#fff';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '50%';
    closeButton.style.width = '30px';
    closeButton.style.height = '30px';
    closeButton.style.fontSize = '20px';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => {
        if (html5QrCode) html5QrCode.stop().catch(err => console.error("Error stopping scanner:", err));
        qrReader.style.display = 'none';
        qrReader.innerHTML = '';
    };
    qrReader.appendChild(closeButton);

    const statusMessage = document.createElement('p');
    statusMessage.textContent = 'Scanning for QR code...';
    statusMessage.style.color = '#fff';
    statusMessage.style.textAlign = 'center';
    qrReader.appendChild(statusMessage);

    html5QrCode = new Html5Qrcode("qr-reader");

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    navigator.mediaDevices.enumerateDevices().then(devices => {
        const rearCameras = devices.filter(device => device.kind === "videoinput" && (device.label.toLowerCase().includes("back") || device.label.toLowerCase().includes("rear")));
        if (rearCameras.length > 0) {
            html5QrCode.start(
                rearCameras[rearCameras.length - 1].deviceId,
                config,
                (decodedText) => {
                    const roomCode = decodedText.trim().toUpperCase();
                    if (roomCode) {
                        html5QrCode.stop().then(() => {
                            document.getElementById('roomCodeInput').value = roomCode;
                            qrReader.style.display = 'none';
                            qrReader.innerHTML = '';
                            joinRoom();
                        });
                    }
                },
                () => { }
            ).catch(err => console.error("Rear camera start failed:", err));
        } else {
            html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    const roomCode = decodedText.trim().toUpperCase();
                    if (roomCode) {
                        html5QrCode.stop().then(() => {
                            document.getElementById('roomCodeInput').value = roomCode;
                            qrReader.style.display = 'none';
                            qrReader.innerHTML = '';
                            joinRoom();
                        });
                    }
                },
                () => { }
            ).catch(err => console.error("All rear camera attempts failed:", err));
            statusMessage.textContent = 'Rear camera unavailable. Using front camera as last resort...';

            html5QrCode.start(
                { facingMode: "user" },
                config,
                (decodedText) => {
                    const roomCode = decodedText.trim().toUpperCase();
                    if (roomCode) {
                        html5QrCode.stop().then(() => {
                            document.getElementById('roomCodeInput').value = roomCode;
                            qrReader.style.display = 'none';
                            qrReader.innerHTML = '';
                            joinRoom();
                        });
                    }
                },
                () => { }
            ).catch(err => {
                console.error("All camera attempts failed:", err);
                alert("Camera permission denied. Please allow camera access and try again.");
                qrReader.style.display = 'none';
                qrReader.innerHTML = '';
            });
        }
    }).catch(err => {
        console.error("Camera permission denied:", err);
        alert("Camera permission denied. Please allow camera access and try again.");
        qrReader.style.display = 'none';
        qrReader.innerHTML = '';
    });
}

const sectionConfigs = [
    { selector: '.blue-head', player: 'blue', clickPoints: 3, swipePoints: 5, clickAction: 'head-click', swipeAction: 'head-swipe' }, // Chong
    { selector: '.red-head', player: 'red', clickPoints: 3, swipePoints: 5, clickAction: 'head-click', swipeAction: 'head-swipe' }, // Hong
    { selector: '.blue-punch', player: 'blue', clickPoints: 1, clickAction: 'punch-click' }, // Chong
    { selector: '.red-punch', player: 'red', clickPoints: 1, clickAction: 'punch-click' }, // Hong
    { selector: '.blue-body', player: 'blue', clickPoints: 2, swipePoints: 4, clickAction: 'body-click', swipeAction: 'body-swipe' }, // Chong
    { selector: '.red-body', player: 'red', clickPoints: 2, swipePoints: 4, clickAction: 'body-click', swipeAction: 'body-swipe' } // Hong
];

function initializeEventListeners() {
    const container = document.querySelector('.container');
    if (!container) {
        console.error("Container not found");
        return false;
    }

    let allFound = true;
    sectionConfigs.forEach(config => {
        const element = document.querySelector(config.selector);
        if (!element) {
            console.warn(`Element ${config.selector} not found`);
            allFound = false;
        }
    });

    if (!allFound) {
        console.log("Retrying element detection in 500ms...");
        return false;
    }

    container.addEventListener('touchstart', (event) => {
        const target = event.target.closest('.section');
        if (!target) return;
        event.preventDefault();
        target.dataset.touchStartX = event.touches[0].clientX;
        target.dataset.touchStartY = event.touches[0].clientY;
        target.dataset.touchStartTime = Date.now();
        console.log(`Touchstart on ${target.className}`);

        target.classList.add('pressed');
    }, { passive: false });

    container.addEventListener('touchend', (event) => {
        const target = event.target.closest('.section');
        if (!target) return;
        event.preventDefault();
        const touchEndX = event.changedTouches[0].clientX;
        const touchEndY = event.changedTouches[0].clientY;
        const touchStartX = parseFloat(target.dataset.touchStartX) || touchEndX;
        const touchStartY = parseFloat(target.dataset.touchStartY) || touchEndY;
        const touchStartTime = parseFloat(target.dataset.touchStartTime) || Date.now();
        const deltaX = Math.abs(touchEndX - touchStartX);
        const deltaY = Math.abs(touchEndY - touchStartY);
        const duration = Date.now() - touchStartTime;

        // Keep the pressed class visible for 300ms so referee can see feedback
        setTimeout(() => target.classList.remove('pressed'), 300);

        if (deltaX < 30 && deltaY < 30 && duration < 400) {
            const config = sectionConfigs.find(c => target.matches(c.selector));
            if (config) {
                console.log(`Tap on ${config.clickAction} for ${config.player}, points: ${config.clickPoints}`);
                submitPoints(config.player, config.clickPoints, config.clickAction);
                target.classList.add('click-animation');
                setTimeout(() => target.classList.remove('click-animation'), 200);
            }
            return;
        }

        if (deltaX > 80 && deltaX > deltaY * 1.5 && duration < 500) {
            const config = sectionConfigs.find(c => target.matches(c.selector) && c.swipePoints);
            if (config) {
                console.log(`Swipe on ${config.swipeAction} for ${config.player}, points: ${config.swipePoints}`);
                submitPoints(config.player, config.swipePoints, config.swipeAction);
                const direction = touchStartX - touchEndX;
                const animationClass = direction < 0 ? 'swipe-animation-left' : 'swipe-animation-right';
                target.classList.add(animationClass);
                setTimeout(() => target.classList.remove('swipe-animation-left', 'swipe-animation-right'), 300);
            }
        }
    }, { passive: false });

    container.addEventListener('click', (event) => {
        const target = event.target.closest('.section');
        if (!target) return;
        event.preventDefault();
        const config = sectionConfigs.find(c => target.matches(c.selector));
        if (config) {
            console.log(`Click on ${config.clickAction} for ${config.player}, points: ${config.clickPoints}`);
            // Add pressed class for visual feedback
            target.classList.add('pressed');
            setTimeout(() => target.classList.remove('pressed'), 300);
            submitPoints(config.player, config.clickPoints, config.clickAction);
            target.classList.add('click-animation');
            setTimeout(() => target.classList.remove('click-animation'), 500);
        }
    }, { passive: false });

    console.log("Event listeners attached");
    return true;
}

function retryInitialization(attempts = 10, delay = 500) {
    if (attempts <= 0) {
        console.error("Failed to initialize event listeners after multiple attempts");
        return;
    }
    const initialized = initializeEventListeners();
    if (!initialized) {
        setTimeout(() => retryInitialization(attempts - 1, delay), delay);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scanQRButton = document.getElementById('scanQRButton');
    if (scanQRButton) {
        scanQRButton.addEventListener('click', scanQRCode);
    }

    const joinRoomButton = document.querySelector('#roomEntry button');
    if (joinRoomButton) {
        joinRoomButton.addEventListener('click', joinRoom);
    }

    const savedRoomId = sessionStorage.getItem('currentRoomId');
    if (savedRoomId && sessionStorage.getItem('isLoggedIn') === 'true') {
        currentRoomId = savedRoomId;
        document.getElementById('roomEntry').style.display = 'none';
        document.getElementById('scoringUI').style.display = 'block';

        db.ref(`rooms/${currentRoomId}/referees`).once('value').then((snapshot) => {
            const referees = snapshot.val() || {};
            const refereeCount = Object.keys(referees).length;

            if (refereeCount >= 4 && !referees[refereeId]) {
                alert("Maximum of 4 referees allowed in this room.");
                sessionStorage.removeItem('isLoggedIn');
                sessionStorage.removeItem('currentRoomId');
                document.getElementById('roomEntry').style.display = 'flex';
                document.getElementById('scoringUI').style.display = 'none';
                return;
            }

            let myName;
            if (referees[refereeId]) {
                myName = referees[refereeId].name;
            } else {
                myName = `Referee ${refereeCount + 1}`;
            }

            db.ref(`rooms/${currentRoomId}/referees/${refereeId}`).set({
                joined: Date.now(),
                name: myName
            }).then(() => {
                sessionStorage.setItem('myName', myName);
            }).catch((error) => {
                console.error("Error setting referee data:", error);
            });

            // Add this line to set up the score listener
            setupScoreListener();
        }).catch((error) => {
            console.error("Error rejoining room:", error);
        });
    }

    const listenersInitialized = initializeEventListeners();
    if (!listenersInitialized) {
        setTimeout(initializeEventListeners, 500);
    }

    checkLoginAndOrientation();
    window.addEventListener('resize', checkLoginAndOrientation);

    document.body.addEventListener('click', function fullscreenRequest() {
        requestFullscreen();
        document.body.removeEventListener('click', fullscreenRequest);
    }, { once: true });

    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        if (window.screen.orientation && window.screen.orientation.lock) {
            window.screen.orientation.lock('landscape').catch(err =>
                console.warn("Orientation lock failed:", err)
            );
        }
    }
});

// Add stub for checkLoginAndOrientation if not defined elsewhere
function checkLoginAndOrientation() {
    // Implement logic if needed, e.g., force landscape
    if (window.innerWidth < window.innerHeight) {
        console.log("Please rotate to landscape mode.");
        // Could show a message to user
    }
}

// Listen for score updates and send to scoreboard
function setupScoreListener() {
    if (!currentRoomId) return;

    console.log("Setting up score listener for room:", currentRoomId);

    // Remove any existing listeners
    db.ref(`rooms/${currentRoomId}`).off('value');

    // Add new listener
    db.ref(`rooms/${currentRoomId}`).on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        console.log("Received score update:", data);

        // We don't update UI here since scores should be displayed on the scoreboard
        // Just log the scores for debugging
        const hongScore = data.teamA?.score || 0;
        const chongScore = data.teamB?.score || 0;
        console.log(`Score update - Hong: ${hongScore}, Chong: ${chongScore}`);

        if (data.lastScoreUpdate) {
            console.log("Last score update timestamp:", data.lastScoreUpdate);
        }
    });
}