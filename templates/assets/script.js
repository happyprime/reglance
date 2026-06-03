const slider = document.querySelector('.slider');
const overlay = document.querySelector('.image-overlay');
const baseImage = document.getElementById('baseImage');
const overlayImage = overlay.querySelector('img');
const toggleButton = document.getElementById('toggleButton');
const rightLabel = document.getElementById('rightLabel');
let isResizing = false;
let isDiffShowing = false;
let currentPosition = 0.5;

/**
 * Set the slider position (0 to 1)
 *
 * @param {number} pos
 */
function setSliderPosition(pos) {
	currentPosition = Math.max(0, Math.min(1, pos));
	overlay.style.clipPath = `inset(0 ${(1 - currentPosition) * 100}% 0 0)`;
	slider.style.left = currentPosition * 100 + '%';
	slider.setAttribute(
		'aria-valuenow',
		String(Math.round(currentPosition * 100))
	);
}

// Pointer Events cover mouse, touch, and pen with one code path, so the
// slider works on phones and tablets too. Capturing the pointer keeps the
// drag tracking even when it leaves the thin handle.
slider.addEventListener('pointerdown', (e) => {
	isResizing = true;
	slider.setPointerCapture(e.pointerId);
});

slider.addEventListener('pointermove', (e) => {
	if (!isResizing) return;
	const containerRect = slider.closest('.compare').getBoundingClientRect();
	setSliderPosition((e.clientX - containerRect.left) / containerRect.width);
});

slider.addEventListener('pointerup', (e) => {
	isResizing = false;
	slider.releasePointerCapture(e.pointerId);
});

slider.addEventListener('keydown', (e) => {
	const step = e.shiftKey ? 0.05 : 0.01;
	if (e.key === 'ArrowLeft') {
		e.preventDefault();
		setSliderPosition(currentPosition - step);
	} else if (e.key === 'ArrowRight') {
		e.preventDefault();
		setSliderPosition(currentPosition + step);
	}
});

toggleButton.addEventListener('click', () => {
	isDiffShowing = !isDiffShowing;

	if (isDiffShowing) {
		baseImage.src = diffImage;
		toggleButton.textContent = 'Show Second Image';
		rightLabel.textContent = 'Diff Image';
	} else {
		baseImage.src = secondImage;
		toggleButton.textContent = 'Show Diff';
		rightLabel.textContent = 'Second Image';
	}
});
