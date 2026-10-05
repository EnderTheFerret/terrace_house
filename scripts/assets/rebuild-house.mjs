// Authored furniture composition, with open walking aisles and a compact irregular floor plan.
import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../../content/house.json', import.meta.url);
const house = JSON.parse(readFileSync(path, 'utf8'));
const rooms = [];
const furniture = [];
const hotspots = [];
const room = (id, x, y, w, h, floor, material, spots) => rooms.push({ ...house.rooms.find(r => r.id === id), x, y, w, h, floor, material, spots });
const f = (type, x, y, w = 1, h = 1, floor = 0, extra = {}) => furniture.push({ type, x, y, w, h, floor, ...extra });
const hot = (id, label, x, y, action, floor = 0) => hotspots.push({ id, label, x, y, action, floor });

house.width = 26; house.height = 20;
room('backyard', 0, 0, 16, 7, 0, 'pooldeck', [[2, 5], [6, 6], [10, 6], [13, 5], [14, 4], [2, 3]]);
room('kitchen', 16, 0, 10, 10, 0, 'tile-cream', [[18, 2], [21, 2], [23, 4], [18, 8], [21, 9], [24, 9]]);
room('living', 6, 7, 10, 10, 0, 'oak', [[6, 11], [10, 12], [12, 10], [14, 14], [11, 14], [14, 16]]);
room('entrance', 0, 7, 6, 7, 0, 'stone', [[3, 10], [4, 12]]);
room('smallBathroom', 0, 14, 6, 6, 0, 'tile-blue', [[3, 18]]);
room('stairs', 16, 10, 6, 7, 0, 'oak', [[19, 13]]);
room('bedroomW', 0, 0, 11, 8, 1, 'oak', [[2, 5], [5, 5], [8, 5], [6, 6]]);
room('bedroomM', 11, 0, 11, 8, 1, 'wood-dark', [[13, 5], [16, 5], [19, 5], [17, 6]]);
room('bathroom', 22, 0, 4, 8, 1, 'tile-blue', [[23, 4], [24, 6]]);
room('hallW', 6, 8, 5, 7, 1, 'oak', [[8, 10], [9, 13]]);
room('stairsUp', 11, 8, 15, 7, 1, 'oak', [[17, 10], [22, 10], [23, 13], [18, 14]]);
room('balconyW', 0, 8, 6, 7, 1, 'deck', [[2, 12], [4, 13]]);
room('balconyM', 16, 15, 10, 5, 1, 'deck', [[17, 17], [22, 18], [24, 18], [18, 18]]);

// Pool: deck seating, plants and towels on the perimeter, water with six distinct places.
f('pool', 3, 2, 8, 4);
f('lounger', 12, 2, 1, 2); f('lounger', 14, 2, 1, 2);
f('bench', 1, 1, 3, 1); f('bigplant', 0, 1, 1, 2); f('bigplant', 15, 1, 1, 2);
f('lantern', 1, 5); f('lantern', 14, 5); f('planter', 6, 0, 3, 1);
// Kitchen: fitted run and breakfast island; six evenly spaced chairs face the table.
f('counter', 17, 1, 2, 1); f('sink', 19, 1); f('counter', 20, 1, 2, 1);
f('stove', 22, 1, 2, 1); f('fridge', 24, 1, 1, 2); f('counter', 17, 2, 1, 2);
f('island', 18, 3, 3, 1); f('stool', 18, 4, 1, 1, 0, { solid: false }); f('stool', 20, 4, 1, 1, 0, { solid: false });
f('rug', 18, 5, 7, 4, 0, { solid: false }); f('diningtable', 19, 6, 5, 2);
// two chairs on each long side, one at each head
for (const y of [5, 8]) for (const x of [20, 22]) f('chair', x, y, 1, 1, 0, { solid: false, dir: y === 5 ? 'down' : 'up' });
f('chair', 18, 6, 1, 1, 0, { solid: false, dir: 'right' }); f('chair', 24, 6, 1, 1, 0, { solid: false, dir: 'left' });
f('whiteboard', 24, 4, 1, 1); f('trashbin', 25, 3); f('bigplant', 25, 8, 1, 2);
// Lounge: sofas face across a coffee table, framing a TV/storage wall and a rug.
f('rug', 7, 10, 7, 7, 0, { solid: false });
f('tv', 9, 8, 3, 2); f('bookshelf', 13, 8, 2, 2); f('bigplant', 15, 8, 1, 2);
f('sofa', 9, 10, 3, 2, 0, { dir: 'down', seats: 3 }); f('sofa', 9, 15, 3, 2, 0, { dir: 'up', seats: 3 });
f('lowtable', 9, 13, 3, 1); f('floorlamp', 6, 14, 1, 2); f('sidetable', 12, 15);
f('plant', 14, 15); f('guitar', 6, 8, 1, 2); f('pouf', 7, 13); f('magazines', 12, 14, 1, 1, 0, { solid: false });
// Genkan: storage against the walls and a welcome mat in front of the street door.
f('shoerack', 1, 8, 2, 2); f('coatrack', 4, 8, 1, 2); f('bench', 1, 11, 2, 1);
f('rug', 1, 12, 3, 1, 0, { solid: false }); f('sneakers', 3, 11, 1, 1, 0, { solid: false }); f('umbrella', 4, 11);
f('frontdoor', 0, 12, 1, 2, 0, { solid: false }); f('plant', 0, 10);
f('bath', 1, 15, 2, 3); f('washbasin', 4, 15, 1, 2); f('washer', 1, 18); f('toilet', 4, 18);
f('stairs', 18, 11, 2, 3, 0, { solid: false }); f('bigplant', 21, 11, 1, 2); f('bookshelf', 17, 15, 3, 1);

// Upstairs: beds against the headboard wall, with their own bedside tables and open foot aisles.
for (const origin of [0, 11]) {
  for (const offset of [1, 4, 7]) { f('bed', origin + offset, 1, 2, 3, 1); f('sidetable', origin + offset + 2, 2, 1, 1, 1); }
  f('clothesrack', origin + 9, 5, 2, 2, 1); f('desk', origin + 1, 6, 2, 1, 1);
  f('plant', origin, 5, 1, 1, 1); f('floorlamp', origin, 1, 1, 2, 1);
}
f('floorcushions', 4, 6, 3, 1, 1, { solid: false }); f('weights', 15, 6, 2, 1, 1, { solid: false }); f('guitar', 18, 6, 1, 1, 1);
f('bath', 23, 1, 2, 3, 1); f('washbasin', 23, 5, 2, 1, 1); f('washer', 25, 6, 1, 1, 1);
f('plant', 6, 9, 1, 1, 1); f('bookshelf', 7, 12, 1, 2, 1); f('bench', 8, 14, 2, 1, 1);
f('void', 12, 10, 5, 4, 1); f('stairs', 23, 10, 2, 3, 1, { solid: false });
f('rug', 18, 9, 4, 5, 1, { solid: false }); f('bookshelf', 18, 8, 3, 1, 1);
f('lowtable', 19, 10, 2, 1, 1); f('sofa', 18, 12, 3, 2, 1, { dir: 'up', seats: 3 }); f('floorlamp', 21, 12, 1, 2, 1); f('bigplant', 25, 8, 1, 2, 1);
f('bench', 1, 10, 3, 1, 1); f('planter', 0, 9, 1, 2, 1); f('planter', 5, 13, 1, 1, 1); f('beanbag', 4, 10, 1, 1, 1);
f('railing', 0, 14, 6, 1, 1); f('lantern', 0, 12, 1, 1, 1);
f('bench', 18, 16, 3, 1, 1); f('planter', 16, 16, 1, 1, 1); f('planter', 25, 16, 1, 1, 1);
f('lounger', 21, 16, 1, 2, 1); f('lounger', 23, 16, 1, 2, 1); f('lantern', 25, 18, 1, 1, 1); f('railing', 16, 19, 10, 1, 1);

house.doors = [[16, 4, 0], [10, 7, 0], [6, 10, 0], [6, 11, 0], [16, 8, 0], [16, 14, 0], [2, 14, 0], [8, 8, 1], [16, 8, 1], [24, 8, 1], [11, 10, 1], [6, 11, 1], [18, 15, 1]];
hot('stove', 'cook', 22, 2, 'cook'); hot('fridge', 'fridge & chores', 24, 3, 'fridge'); hot('whiteboard', 'chore board', 24, 4, 'fridge');
hot('sofa', 'hang out', 12, 13, 'hangout'); hot('tv', 'hobby', 12, 10, 'hobby'); hot('sink', 'tidy up', 19, 2, 'tidy');
hot('backyard', 'pool deck', 11, 5, 'backyard'); hot('pool', 'swim or invite housemates', 7, 6, 'pool'); hot('door', 'go out', 1, 12, 'map');
hot('stairs-up', 'go upstairs', 19, 13, 'stairs-up'); hot('stairs-down', 'go downstairs', 24, 12, 'stairs-down', 1);
hot('bedW', 'rest', 2, 4, 'rest', 1); hot('bedM', 'rest', 13, 4, 'rest', 1);
hot('balconyW', 'quiet balcony', 4, 12, 'balconyW', 1); hot('balconyM', 'quiet balcony', 18, 18, 'balconyM', 1);
house.rooms = rooms; house.furniture = furniture; house.hotspots = hotspots;
writeFileSync(path, JSON.stringify(house, null, 2) + '\n');
