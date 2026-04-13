const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { randomUUID } = require('crypto');

const planningTaskImagesDir = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'planning');

fs.mkdirSync(planningTaskImagesDir, { recursive: true });

function isPlanningImagePath(imagePath) {
  return Boolean(imagePath) && String(imagePath).startsWith('/uploads/planning/');
}

function buildPlanningTaskImagePath(filename) {
  return `/uploads/planning/${filename}`;
}

function resolvePlanningTaskImagePath(imagePath) {
  if (!isPlanningImagePath(imagePath)) {
    return null;
  }

  return path.join(planningTaskImagesDir, path.basename(imagePath));
}

async function deletePlanningTaskImage(imagePath) {
  const absolutePath = resolvePlanningTaskImagePath(imagePath);
  if (!absolutePath) {
    return;
  }

  try {
    await fsPromises.unlink(absolutePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.error('Error al borrar la imagen de la tarea:', error);
    }
  }
}

async function clonePlanningTaskImage(imagePath) {
  const sourcePath = resolvePlanningTaskImagePath(imagePath);
  if (!sourcePath) {
    return null;
  }

  try {
    await fsPromises.access(sourcePath);
  } catch (_error) {
    return null;
  }

  const extension = path.extname(sourcePath).toLowerCase() || '.png';
  const filename = `planning-task-${randomUUID()}${extension}`;
  const destinationPath = path.join(planningTaskImagesDir, filename);
  await fsPromises.copyFile(sourcePath, destinationPath);
  return buildPlanningTaskImagePath(filename);
}

module.exports = {
  planningTaskImagesDir,
  buildPlanningTaskImagePath,
  deletePlanningTaskImage,
  clonePlanningTaskImage,
};
