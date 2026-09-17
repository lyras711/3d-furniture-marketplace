import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


def arguments():
    values = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return dict(zip((key.removeprefix('--') for key in values[::2]), values[1::2]))


def metres(value):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError('Required source measurement is missing or invalid; do not infer overall dimensions.')
    return value / 100.0


def sample_fabric(product, variant, root):
    images = [image for image in product['sourceImages'] if image['sourceUrl'] in variant['sourceImageUrls'] and image['downloaded'] and image['localPath'] and image['role'] == 'gallery']
    if not images:
        raise ValueError('No downloaded full product photograph is associated with this variant.')
    reference = images[0]
    image = bpy.data.images.load(str(root / reference['localPath']), check_existing=True)
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    crop = pixels[int(height * 0.42):int(height * 0.76), int(width * 0.24):int(width * 0.62), :3].reshape(-1, 3)
    brightness = crop.mean(axis=1)
    crop = crop[(brightness > 0.08) & (brightness < 0.82) & (np.max(crop, axis=1) - np.min(crop, axis=1) < 0.18)]
    if len(crop) < 50:
        raise ValueError('Fabric colour sampling failed; review the reference image and crop.')
    sampled = np.median(crop, axis=0)
    linear = np.where(sampled <= 0.04045, sampled / 12.92, ((sampled + 0.055) / 1.055) ** 2.4)
    patch = pixels[int(height * 0.19):int(height * 0.31), int(width * 0.27):int(width * 0.42), :3].mean(axis=2)
    size = min(patch.shape)
    patch = patch[(patch.shape[0] - size) // 2:(patch.shape[0] + size) // 2, (patch.shape[1] - size) // 2:(patch.shape[1] + size) // 2]
    patch = patch / max(float(np.median(patch)), 0.01)
    return linear, patch, {'sourceUrl': reference['sourceUrl'], 'localPath': reference['localPath'], 'cropFractionXY': [0.24, 0.42, 0.62, 0.76], 'fabricPatchFractionXY': [0.27, 0.19, 0.42, 0.31], 'sampledSRGB': sampled.tolist(), 'method': 'median neutral midtones converted sRGB to linear; reflected fabric-only patch for surface variation; lighting is not calibrated'}


def image_map(name, rgb, output, non_color=False):
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    if non_color:
        image.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate((np.clip(rgb, 0, 1), np.ones((height, width, 1))), axis=2).astype(np.float32)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(output / f'{name}.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image


def fabric_maps(color, patch, output):
    size = 1024
    y, x = np.mgrid[0:size, 0:size] / size
    rng = np.random.default_rng(162638)
    nap = np.zeros((size, size))
    for _ in range(28):
        kx, ky = rng.integers(2, 80, size=2)
        nap += np.sin(2 * np.pi * (kx * x + ky * y) + rng.uniform(0, 2 * np.pi)) / 28
    warp = np.sin(2 * np.pi * x * 256)
    weft = np.sin(2 * np.pi * y * 256)
    weave = warp * weft
    noise = rng.uniform(-1, 1, (size, size))
    reflected = np.block([[patch, np.fliplr(patch)], [np.flipud(patch), np.flip(patch)]])
    rows = np.linspace(0, reflected.shape[0] - 1, size)
    cols = np.linspace(0, reflected.shape[1] - 1, size)
    horizontal = np.array([np.interp(cols, np.arange(reflected.shape[1]), row) for row in reflected])
    variation = np.array([np.interp(rows, np.arange(reflected.shape[0]), column) for column in horizontal.T]).T
    variation = np.clip(variation, 0.78, 1.22)
    base = color[None, None, :] * (variation[:, :, None] + nap[:, :, None] * 0.16 + weave[:, :, None] * 0.025 + noise[:, :, None] * 0.03)
    relief = nap * 0.2 + weave * 0.025 + (variation - 1) * 0.12
    dx = (np.roll(relief, -1, 1) - np.roll(relief, 1, 1)) * 0.6
    dy = (np.roll(relief, -1, 0) - np.roll(relief, 1, 0)) * 0.6
    normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    roughness = np.clip(0.88 + nap * 0.08, 0.7, 1)
    return {
        'color': image_map('fabric-color', base, output),
        'normal': image_map('fabric-normal', normals * 0.5 + 0.5, output, True),
        'roughness': image_map('fabric-roughness', np.repeat(roughness[:, :, None], 3, axis=2), output, True),
    }


def material(name, color, maps=None):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = (*color, 1)
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.87 if maps else 0.45
    if maps:
        shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
        shader.inputs['Sheen Weight'].default_value = 0.16
        for key, socket in [('color', 'Base Color'), ('roughness', 'Roughness')]:
            node = nodes.new('ShaderNodeTexImage')
            node.image = maps[key]
            links.new(node.outputs['Color'], shader.inputs[socket])
        node = nodes.new('ShaderNodeTexImage')
        node.image = maps['normal']
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = 0.4
        links.new(node.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    return result


def upholstered(name, dimensions, location, mat, radius=0.025, softness=0.003, seed=0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new('Upholstery edge profile', 'BEVEL')
    bevel.width = min(radius, min(dimensions) * 0.3)
    bevel.segments = 5
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    subdiv = obj.modifiers.new('Upholstery surface', 'SUBSURF')
    subdiv.subdivision_type = 'CATMULL_CLARK'
    subdiv.levels = 3
    bpy.ops.object.modifier_apply(modifier=subdiv.name)
    mesh = obj.data
    points = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    normals = np.empty_like(points)
    mesh.vertices.foreach_get('co', points)
    mesh.vertices.foreach_get('normal', normals)
    points, normals = points.reshape(-1, 3), normals.reshape(-1, 3)
    q = points / (np.array(dimensions) / 2)
    axes = np.argmax(np.abs(normals), axis=1)
    tangents = np.array([[1, 2], [0, 2], [0, 1]])[axes]
    uv = np.take_along_axis(q, tangents, axis=1)
    u, v = uv[:, 0], uv[:, 1]
    edge = np.maximum(np.abs(u), np.abs(v))
    bulge = np.maximum(0, 1 - u * u) * np.maximum(0, 1 - v * v)
    gathered = np.exp(-((edge - 0.83) / 0.15) ** 2)
    ripples = np.sin(q[:, 0] * 39 + q[:, 2] * 9 + seed) * np.sin(q[:, 1] * 31 - q[:, 0] * 7 + seed * 1.7)
    points += normals * (softness * (bulge + gathered * ripples * 0.15))[:, None]
    mesh.vertices.foreach_set('co', points.astype(np.float32).ravel())
    mesh.polygons.foreach_set('use_smooth', np.ones(len(mesh.polygons), dtype=bool))
    mesh.update()
    face_normals = np.empty(len(mesh.polygons) * 3, dtype=np.float32)
    loop_counts = np.empty(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get('normal', face_normals)
    mesh.polygons.foreach_get('loop_total', loop_counts)
    face_axes = np.argmax(np.abs(face_normals.reshape(-1, 3)), axis=1)
    loop_axes = np.repeat(np.array([[1, 2], [0, 2], [0, 1]])[face_axes], loop_counts, axis=0)
    indices = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', indices)
    coords = np.take_along_axis(points[indices], loop_axes, axis=1) / 0.32
    mesh.uv_layers.active.data.foreach_set('uv', coords.astype(np.float32).ravel())
    print(f'Built {name}: {len(mesh.polygons)} faces', flush=True)
    obj.data.materials.append(mat)
    obj.rotation_euler = rotation
    return obj


def loose_pillow(name, dimensions, location, mat, rotation):
    width, height, thickness = dimensions
    n = 80
    vertices, faces, uv = [], [], []
    for side in [1, -1]:
        for row in range(n + 1):
            v = row / n * 2 - 1
            for col in range(n + 1):
                u = col / n * 2 - 1
                inflation = max(0, (1 - u * u) * (1 - v * v)) ** 0.55
                gather = math.exp(-((max(abs(u), abs(v)) - 0.86) / 0.12) ** 2)
                crease = 0.002 * gather * math.sin(u * 44 + v * 9) * math.sin(v * 37 - u * 12)
                vertices.append((u * width / 2, v * height / 2, side * (0.003 + thickness * 0.5 * inflation + crease)))
                uv.append((col / n * width / 0.32, row / n * height / 0.32))
    layer = (n + 1) ** 2
    for side in range(2):
        for row in range(n):
            for col in range(n):
                i = side * layer + row * (n + 1) + col
                face = (i, i + 1, i + n + 2, i + n + 1)
                faces.append(face if side == 0 else tuple(reversed(face)))
    perimeter = list(range(n + 1)) + [row * (n + 1) + n for row in range(1, n + 1)] + [n * (n + 1) + col for col in range(n - 1, -1, -1)] + [row * (n + 1) for row in range(n - 1, 0, -1)]
    for index, a in enumerate(perimeter):
        b = perimeter[(index + 1) % len(perimeter)]
        faces.append((a, a + layer, b + layer, b))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.polygons.foreach_set('use_smooth', np.ones(len(faces), dtype=bool))
    layer_uv = mesh.uv_layers.new(name='Fabric UV')
    layer_uv.data.foreach_set('uv', np.array([uv[loop.vertex_index] for loop in mesh.loops], dtype=np.float32).ravel())
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location, obj.rotation_euler = location, rotation
    obj.data.materials.append(mat)
    return obj


def seam(name, width, height, offset, parent, mat, axis='xy'):
    radius = min(0.024, width * 0.06, height * 0.12)
    points = []
    for cx, cy, start in [(width / 2 - radius, height / 2 - radius, 0), (-width / 2 + radius, height / 2 - radius, 90), (-width / 2 + radius, -height / 2 + radius, 180), (width / 2 - radius, -height / 2 + radius, 270)]:
        for step in range(24):
            angle = math.radians(start + step * 90 / 24)
            a, b = cx + radius * math.cos(angle), cy + radius * math.sin(angle)
            points.append((a, b, offset) if axis == 'xy' else (a, offset, b))
    return cord(name, points, mat, 0.0012, parent, True)


def cord(name, points, mat, radius, parent=None, cyclic=False):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for other in bpy.context.selected_objects:
        if other != obj:
            other.select_set(False)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def strap(name, x, y, z, mat, length=0.14):
    vertices, faces = [], []
    for i in range(65):
        t = i / 64
        side = 0.016 * math.cos(math.pi * t)
        drop = length * math.sin(math.pi * t)
        forward = 0.018 * math.sin(math.pi * t)
        vertices.extend([(x + side - 0.008, y - drop, z + forward), (x + side + 0.008, y - drop, z + forward)])
        if i:
            faces.append((2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    solid = obj.modifiers.new('Strap thickness', 'SOLIDIFY')
    solid.thickness = 0.002
    return obj


def bounds(objects):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low, high = np.full(3, np.inf), np.full(3, -np.inf)
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        points = np.empty(len(evaluated.data.vertices) * 3, dtype=np.float32)
        evaluated.data.vertices.foreach_get('co', points)
        matrix = np.array(evaluated.matrix_world)
        world = points.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
        low, high = np.minimum(low, world.min(axis=0)), np.maximum(high, world.max(axis=0))
    return Vector(low), Vector(high)


def aim(obj, target):
    back = (obj.location - Vector(target)).normalized()
    right = Vector((0, 1, 0)).cross(back).normalized()
    up = back.cross(right)
    obj.rotation_euler = Matrix((right, up, back)).transposed().to_euler()


def render_views(objects, output, length, depth, height):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('Neutral product studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, -0.002, 0), rotation=(math.pi / 2, 0, 0))
    floor = bpy.context.object
    floor.name = 'Studio_Floor'
    floor.data.materials.append(material('Studio_Backdrop', (0.85, 0.85, 0.85)))
    for position, energy, size in [((-3, 4, 4), 500, 4), ((3, 2, 1), 200, 3), ((0, 3, -3), 350, 3)]:
        data = bpy.data.lights.new('Studio_Softbox', 'AREA')
        data.energy, data.shape, data.size = energy, 'DISK', size
        light = bpy.data.objects.new('Studio_Softbox', data)
        scene.collection.objects.link(light)
        light.location = position
        aim(light, (0, height / 2, 0))
    camera = bpy.data.objects.new('Review_Camera', bpy.data.cameras.new('Review_Camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = length * 1.22
    for name, position, target in [
        ('thumbnail', (-3, 1.3, 5), (0, height * 0.43, 0)),
        ('front', (0, height * 0.5, 5), (0, height * 0.5, 0)),
        ('side', (5, height * 0.5, 0), (0, height * 0.5, 0)),
        ('rear', (0, height * 0.5, -5), (0, height * 0.5, 0)),
    ]:
        camera.location = position
        aim(camera, target)
        scene.render.filepath = str(output / f'{name}.png')
        bpy.ops.render.render(write_still=True)
    for obj in list(scene.objects):
        if obj not in objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def main():
    args = arguments()
    product_path = Path(args['product-json']).resolve()
    output = Path(args['output-dir']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    product = json.loads(product_path.read_text())
    if product.get('id') != 'polihome-vancouver-162638009':
        raise ValueError('This photo-authored reconstruction is Vancouver-specific; another product requires its own reference reconstruction.')
    variant = next(item for item in product['variants'] if item['id'] == args['variant-id'])
    d = product['dimensionsCm']
    length, depth, height = metres(d['length']), metres(d['cornerDepth']), metres(d['height'])
    seat_height, feet_height, standard_depth = metres(d['seatHeight']), metres(d['feetHeight']), metres(d['depth'])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    color, patch, reference = sample_fabric(product, variant, product_path.parent)
    maps = fabric_maps(color, patch, output)
    fabric = material('Vancouver_Upholstery', tuple(color), maps)
    cushions = material('Vancouver_Cushion_Fabric', tuple(color), maps)
    thread = material('Vancouver_Seam_Thread', tuple(float(v) * 0.82 for v in color))
    plastic = material('Vancouver_Plastic_Feet', (0.022, 0.023, 0.025))
    objects = []
    arm = (length - metres(d['bedLength'])) / 2
    if not 0.07 < arm < 0.3:
        raise ValueError('Sleeping length does not support the photo-inferred arm-width relationship; review references.')
    arm_height = seat_height + (height - seat_height) * 0.35
    inner = length - 2 * arm
    chaise_width = inner / 3 + arm
    split = length / 2 - chaise_width
    back = -depth / 2
    seat_front = back + standard_depth
    seat_rear = back + standard_depth * 0.24
    cushion_thickness = seat_height * 0.23
    base_top = seat_height - cushion_thickness
    gap = 0.009
    wide = split - (-length / 2 + arm)
    chaise_x = split + chaise_width / 2
    wide_x = -length / 2 + arm + wide / 2
    objects.append(upholstered('Vancouver_Main_Base', (wide, base_top - feet_height, standard_depth - 0.025), (wide_x, (base_top + feet_height) / 2, back + standard_depth / 2), fabric, 0.018, 0.001))
    objects.append(upholstered('Vancouver_Chaise_Base', (chaise_width - gap, base_top - feet_height, depth - 0.04), (chaise_x, (base_top + feet_height) / 2, 0), fabric, 0.018, 0.001))
    for side in [-1, 1]:
        objects.append(upholstered(f'Vancouver_Arm_{side}', (arm, arm_height - feet_height, standard_depth), (side * (length - arm) / 2, (arm_height + feet_height) / 2, back + standard_depth / 2), fabric, 0.023, 0, side))
    back_depth = standard_depth * 0.145
    objects.append(upholstered('Vancouver_Rear_Frame', (inner, height * 0.71 - base_top, back_depth), (0, (height * 0.71 + base_top) / 2, back + back_depth / 2 + 0.001), fabric, 0.018, 0.001))
    for name, x, width, front in [('Wide', wide_x, wide - gap, seat_front), ('Chaise', chaise_x, chaise_width - gap, depth / 2)]:
        seat = upholstered(f'Vancouver_Seat_{name}', (width, cushion_thickness, front - seat_rear), (x, seat_height - cushion_thickness / 2 - 0.009, (front + seat_rear) / 2), cushions, 0.032, 0.009, 2)
        objects.extend([seat, seam(f'Vancouver_Seat_Seam_{name}', width - 0.025, front - seat_rear - 0.025, -cushion_thickness * 0.32, seat, thread, 'xz')])
    back_width = (inner - 0.016) / 3
    back_height = height - seat_height + 0.08
    for i in range(3):
        x = -inner / 2 + back_width / 2 + i * (back_width + 0.008)
        cushion = upholstered(f'Vancouver_Back_Cushion_{i + 1}', (back_width - 0.008, back_height, 0.155), (x, height - back_height / 2 - 0.018, back + 0.15), cushions, 0.034, 0.01, 4 + i, (-0.13, 0, (-1 + i) * 0.008))
        objects.extend([cushion, seam(f'Vancouver_Back_Seam_{i + 1}', back_width - 0.035, back_height - 0.04, 0.066, cushion, thread)])
    for side in [-1, 1]:
        pillow = loose_pillow(f'Vancouver_Loose_Pillow_{side}', (0.32, 0.30, 0.16), (side * (inner / 2 - 0.17), seat_height + 0.15, back + 0.33), cushions, (-0.17, 0.65 if side < 0 else -0.12, -0.3 if side < 0 else 0.12))
        objects.extend([pillow, seam(f'Vancouver_Pillow_Seam_{side}', 0.32, 0.30, 0, pillow, thread)])
    objects.append(strap('Vancouver_Chaise_Pull_Strap', chaise_x, base_top - 0.012, depth / 2 - 0.021, fabric))
    for side in [-1, 1]:
        objects.append(strap(f'Vancouver_Sleeper_Tab_{side}', wide_x + side * wide * 0.25, base_top - 0.003, seat_front - 0.01, fabric, 0.022))
    for i, (x, z) in enumerate([
        (-length / 2 + arm / 2, back + 0.09), (-length / 2 + arm / 2, seat_front - 0.08),
        (length / 2 - arm / 2, back + 0.09), (length / 2 - arm / 2, seat_front - 0.08),
        (chaise_x - chaise_width / 2 + 0.07, depth / 2 - 0.09), (chaise_x + chaise_width / 2 - 0.07, depth / 2 - 0.09),
        (wide_x - wide / 2 + 0.06, seat_front - 0.08), (wide_x + wide / 2 - 0.06, seat_front - 0.08),
    ]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.022, depth=feet_height, location=(x, feet_height / 2, z), rotation=(math.pi / 2, 0, 0))
        foot = bpy.context.object
        foot.name = f'Vancouver_Plastic_Foot_{i + 1}'
        foot.data.materials.append(plastic)
        bevel = foot.modifiers.new('Foot edge', 'BEVEL')
        bevel.width, bevel.segments = 0.002, 3
        for poly in foot.data.polygons:
            poly.use_smooth = True
        objects.append(foot)
    corrections = []
    for obj in objects:
        if obj.name.startswith('Vancouver_Back_Cushion_'):
            low, high = bounds([obj] + list(obj.children))
            dy, dz = height - high.y, max(0, back - low.z)
            obj.location.y += dy
            obj.location.z += dz
            corrections.append({'object': obj.name, 'method': 'translate cushion and child seams to measured height and rear envelope', 'translationMetres': [0, dy, dz], 'scaling': 'none'})
        elif obj.name == 'Vancouver_Seat_Chaise':
            low, high = bounds([obj] + list(obj.children))
            dx, dz = min(0, length / 2 - high.x), depth / 2 - high.z
            obj.location.x += dx
            obj.location.z += dz
            corrections.append({'object': obj.name, 'method': 'translate chaise cushion to measured front and right envelope', 'translationMetres': [dx, 0, dz], 'scaling': 'none'})
    low, high = bounds(objects)
    generated = {'length': (high.x - low.x) * 100, 'height': (high.y - low.y) * 100, 'depth': (high.z - low.z) * 100}
    for key, value in [('length', length), ('height', height), ('depth', depth)]:
        if abs(generated[key] / 100 - value) / value > 0.03:
            raise ValueError(f'Generated {key} exceeds 3 percent tolerance; review component geometry.')
    if abs(low.y) > 0.001:
        raise ValueError('Generated model does not rest on Y=0.')
    for obj in objects:
        obj['productId'] = product['id']
        obj['geometryEvidence'] = 'photo-inferred; overall dimensions source-measured'
    render_views(objects, output, length, depth, height)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'generation.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    output_name = args.get('output-name', 'shared.glb')
    bpy.ops.export_scene.gltf(filepath=str(output / output_name), export_format='GLB', use_selection=True, export_yup=False, export_apply=True, export_extras=True, export_animations=False)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = sum(sum(len(p.vertices) - 2 for p in obj.evaluated_get(depsgraph).data.polygons) for obj in objects)
    metadata = {
        'productId': product['id'], 'variantId': variant['id'], 'format': 'glb', 'unitSystem': 'metres',
        'coordinateFrame': {'up': '+Y', 'length': 'X', 'depth': 'Z', 'front': '+Z', 'floor': 0, 'blenderExportYUpConversion': False},
        'generatedDimensionsCm': generated, 'sourceDimensionsCm': {'length': d['length'], 'depth': d['cornerDepth'], 'height': d['height']},
        'polygonCount': triangles, 'polygonCountUnit': 'evaluated triangles', 'generationMethod': 'Vancouver photo-authored high-poly reconstruction v2',
        'materialNames': [fabric.name, cushions.name, plastic.name], 'materialReference': reference,
        'materialStatus': 'generated tileable nap/weave maps with photo-sampled colour; not measured physical fabric',
        'visualAccuracy': 'pending-human-review', 'corrections': corrections,
        'referenceUrls': variant['sourceImageUrls'], 'reviewViews': ['thumbnail.png', 'front.png', 'side.png', 'rear.png'],
        'photoInferred': {'backCushionCount': 3, 'seatCushionCount': 2, 'loosePillowCount': 2, 'armWidthCm': arm * 100, 'armWidthInference': '(external length - sleeping length) / 2; inferred relationship, not a directly measured arm', 'armHeightCm': arm_height * 100, 'chaiseWidthCm': chaise_width * 100, 'backTiltRadians': -0.13},
        'limitations': ['Component sizes, fabric weave, seams and wrinkles are inferred from photographs.', 'Closed sofa only; sleeping and storage mechanisms are not animated.', 'Rear and hidden construction are not manufacturer-verified.', 'This product-specific recipe is not an automatic reconstruction algorithm for arbitrary furniture.'],
        'thumbnailPath': str(output / 'thumbnail.png'),
    }
    (output / 'model-metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    (output / 'generation-status.json').write_text(json.dumps({'status': 'generated', **metadata}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
