// touchControls.js — on-screen buttons for phones and tablets.
// Owns the button layer inside #game-stage. Game rules stay in main.js, which supplies the
// handlers and tells this layer each frame whether to show CAST or REEL.

const TOUCH_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';

export function isTouchDevice() {
  return window.matchMedia(TOUCH_MEDIA_QUERY).matches;
}

function makeButton(className, label, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `touch-button ${className}`;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

// Runs onPress/onRelease for one finger at a time. Listens on window for the release because
// the game can hide the button while it is still held, such as when a fish lands.
function bindHold(button, onPress, onRelease) {
  let activePointer = null;

  const release = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    button.classList.remove('pressed');
    onRelease();
  };

  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    button.classList.add('pressed');
    onPress();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}

// handlers: { onActionPress(), onActionRelease(), onAim(direction) } where direction is -1, 0 or 1.
export function installTouchControls(stageElement, handlers) {
  const layer = document.createElement('div');
  layer.id = 'touch-controls';

  const aimGroup = document.createElement('div');
  aimGroup.className = 'touch-aim-group';
  const aimLeft = makeButton('touch-aim', '◀', 'Aim left');
  const aimRight = makeButton('touch-aim', '▶', 'Aim right');
  aimGroup.append(aimLeft, aimRight);

  const action = makeButton('touch-action', 'CAST', 'Cast');

  layer.append(aimGroup, action);
  stageElement.appendChild(layer);

  bindHold(aimLeft, () => handlers.onAim(-1), () => handlers.onAim(0));
  bindHold(aimRight, () => handlers.onAim(1), () => handlers.onAim(0));
  bindHold(action, handlers.onActionPress, handlers.onActionRelease);

  // A long press would otherwise open the phone's copy or share menu over the game.
  stageElement.addEventListener('contextmenu', (e) => e.preventDefault());

  let lastLabel = 'CAST';
  return {
    // label: 'CAST' or 'REEL'. visible: false while a menu covers the stage.
    update({ label, visible, aimEnabled }) {
      layer.classList.toggle('visible', visible);
      aimGroup.classList.toggle('disabled', !aimEnabled);
      if (label !== lastLabel) {
        action.textContent = label;
        action.setAttribute('aria-label', label === 'CAST' ? 'Cast' : 'Reel');
        action.classList.toggle('reel', label === 'REEL');
        lastLabel = label;
      }
    },
  };
}
