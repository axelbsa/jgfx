struct Params {
    time : f32
};

struct Ray {
    orig : vec3f,
    dir  : vec3f,
};

struct Sphere {
    center : vec3f,
    radius : f32,
    //material_index : u32,
    //texture_index : u32,
    //material_type : u32,
};

struct hit_record {
    p : vec3f,
    normal : vec3f,
    t : f32,
    front_face: bool,
};

@group(0) @binding(0) var output : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params : Params;


fn hsv(h : f32, s : f32, v : f32) -> vec3f {
    let k = vec3f(1.0, 2.0/3.0, 1.0/3.0);
    let p = abs(fract(vec3f(h) + k) * 6.0 - 3.0);
    return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}


fn set_face_normal(r : Ray, outward_normal : vec3f, rec : ptr<function, hit_record>) {
    // Sets the hit record normal vector.
    // NOTE: the parameter `outward_normal` is assumed to have unit length.

    let front_face = dot(r.dir, outward_normal) < 0;
    (*rec).normal = select(-outward_normal, outward_normal, front_face);
    //normal = front_face ? outward_normal : -outward_normal;
}

fn at(r: Ray, t : f32) -> vec3f {
    return r.orig + t*r.dir;
}

fn squared_length(v : vec3f) -> f32 {
    return v.x*v.x + v.y*v.y + v.z*v.z;
}

//bool hit_sphere(Ray r, float t_min, float t_max, int object_index, inout hit_record rec)
fn hit_sphere(r : Ray, ray_tmin : f32, ray_tmax : f32, rec : ptr<function, hit_record>, sp : Sphere) -> bool {
//fn hit_sphere(center : vec3f, radius : f32, r : Ray) -> f32 {
    let oc = sp.center - r.orig;
    let a = squared_length(r.dir);
    let h = dot(r.dir, oc);
    let c = squared_length(oc) - sp.radius*sp.radius;
    let discriminant = h*h - a*c;

    if (discriminant < 0) {
        return false;
    }

    let sqrtd = sqrt(discriminant);

    var root : f32 = (h - sqrtd) / a;
    if (root <= ray_tmin || ray_tmax <= root) {
        root = (h + sqrtd) / a;
        if (root <= ray_tmin || ray_tmax <= root) {
            return false;
        }
    }

    (*rec).t = root;
    (*rec).p = at(r, (*rec).t);
    (*rec).normal = ((*rec).p - sp.center) / sp.radius;
    return true;
}

fn ray_color(r : Ray) -> vec3f {
    var rec = hit_record();
    let sp = Sphere(vec3f(0, 0, -1), 0.5);
    let t = hit_sphere(r, 0.0, 300, &rec, sp);
    if (t) {
        //let N = normalize(at(r, t) - vec3(0, 0, -1));
        //return 0.5 * vec3(N.x + 1, N.y + 1, N.z + 1);
        return vec3f(0,0,0);
    }

    let unit_direction = normalize(r.dir);
    let a = 0.5 * (unit_direction.y + 1.0);
    return (1.0-a) * vec3(1.0, 1.0, 1.0) + a * vec3(0.5, 0.7, 1.0);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id : vec3u) {
    let dims = textureDimensions(output);
    if (id.x >= dims.x || id.y >= dims.y) { return; }

    var r = Ray();
    var color = vec3f(0, 0, 0);

    /* ============================================= */
    /* All of these should be moved to the host side */
    let aspect_ratio = 16.0 / 9.0;
    let image_width = f32(dims.x);

    // Calculate the image height, and ensure that it's at least 1.
    let image_height: f32 = image_width / aspect_ratio;

    // Camera
    let focal_length = 1.0;
    let viewport_height = 2.0;
    let viewport_width = viewport_height * (f32(image_width) / f32(image_height));
    let camera_center = vec3f(0, 0, 0);

    // Calculate the vectors across the horizontal and down the vertical viewport edges.
    let viewport_u = vec3f(viewport_width, 0, 0);
    let viewport_v = vec3f(0, -viewport_height, 0);

    // Calculate the horizontal and vertical delta vectors from pixel to pixel.
    let pixel_delta_u = viewport_u / f32(image_width);
    let pixel_delta_v = viewport_v / f32(image_height);

    // Calculate the location of the upper left pixel.
    let viewport_upper_left = camera_center - vec3f(0, 0, focal_length) - viewport_u/2 - viewport_v/2;
    let pixel00_loc = viewport_upper_left + 0.5 * (pixel_delta_u + pixel_delta_v);

    let pixel_center = pixel00_loc + (f32(id.x) * pixel_delta_u) + (f32(id.y) * pixel_delta_v);
    let ray_direction = pixel_center - camera_center;
    /* ============================================= */

    r = Ray(camera_center, ray_direction);

    color = ray_color(r);
    textureStore(output, id.xy, vec4f(color, 1.0));
}
