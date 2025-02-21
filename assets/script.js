const slider = document.querySelector('.slider');
const overlay = document.querySelector('.image-overlay');
const baseImage = document.getElementById('baseImage');
const overlayImage = overlay.querySelector('img');
const toggleButton = document.getElementById('toggleButton');
const rightLabel = document.getElementById('rightLabel');
let isResizing = false;
let isDiffShowing = false;

slider.addEventListener('mousedown', (e) => {
	isResizing = true;
	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onMouseUp);
});

function onMouseMove(e) {
	if (!isResizing) return;
	const container = slider.closest('.compare');
	const containerRect = container.getBoundingClientRect();
	let pos = (e.pageX - containerRect.left) / containerRect.width;
	pos = Math.max(0, Math.min(1, pos));
	overlay.style.clipPath = `inset(0 ${(1 - pos) * 100}% 0 0)`;
	slider.style.left = pos * 100 + '%';
}

function onMouseUp() {
	isResizing = false;
	document.removeEventListener('mousemove', onMouseMove);
	document.removeEventListener('mouseup', onMouseUp);
}

toggleButton.addEventListener('click', () => {
	isDiffShowing = !isDiffShowing;
	if (isDiffShowing) {
		baseImage.src = '';
		toggleButton.textContent = 'Show Second Image';
		rightLabel.textContent = 'Diff Image';
	} else {
		baseImage.src = '';
		toggleButton.textContent = 'Show Diff';
		rightLabel.textContent = 'Second Image';
	}
});
