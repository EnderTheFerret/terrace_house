import type { CSSProperties } from 'react';
import type { RecipeStep } from '@shared-roof/shared';
import { useGame } from '../store';

const dishes = ['miso-soup', 'curry-rice', 'tamagoyaki', 'yakisoba', 'onigiri-set', 'shortcake', 'mapo-tofu', 'okonomiyaki', 'nabe', 'mujaddara', 'falafel-pita', 'lemon-chicken', 'latkes', 'strawberry-pancakes', 'eggplant-tahini'];
const ingredients = ['rice', 'egg', 'onion', 'carrot', 'potato', 'chicken', 'spice', 'pita', 'eggplant', 'tahini', 'chickpea', 'lentils', 'tomato', 'cucumber', 'lemon', 'pepper', 'flour', 'breadcrumbs', 'milk', 'sugar', 'rosewater', 'strawberry', 'butter', 'parsley', 'falafel'];

export function FoodSprite({ id, ingredient = false, size = 80 }: { id: string; ingredient?: boolean; size?: number }) {
  const index = (ingredient ? ingredients : dishes).indexOf(id);
  if (index < 0) return null;
  const rows = ingredient ? 5 : 3;
  return <span aria-hidden className="food-sprite" style={{ width: size, height: size, backgroundImage: `url(/assets/cooking/${ingredient ? 'ingredients' : 'dishes'}.png)`, backgroundSize: `500% ${rows * 100}%`, backgroundPosition: `${(index % 5) * 25}% ${Math.floor(index / 5) * 100 / (rows - 1)}%` }} />;
}

export function CookingAnimation({ type, playing = false, speed = 0.8, pulse = 0 }: { type: RecipeStep['type']; playing?: boolean; speed?: number; pulse?: number }) {
  const paused = useGame(s => s.settings.reducedMotion || s.screen === 'guide');
  return <div className="cooking-stage" aria-hidden>
    <span key={type === 'chop' ? pulse : type} className={`cooking-action ${type === 'chop' && pulse > 0 && !paused ? 'cooking-cut' : ''}`} style={{ backgroundImage: `url(/assets/cooking/${type}.png)`, animationDuration: `${speed}s`, animationPlayState: playing && !paused ? 'running' : 'paused' } as CSSProperties} />
  </div>;
}
