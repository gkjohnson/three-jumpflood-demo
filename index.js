
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let camera, scene, renderer, controls;
let effectQuad, jfaQuad, seedQuad, expandQuad;
let infoContainer;
let targets, seedMaterial, masks, maskMaterial;

let frameTime = 0;
let frameSamples = 0;
let lastFrameStart = - 1;

const box = new THREE.Box3();
const sphere = new THREE.Sphere();

const params = {
    mode: 5,
    inside: false,
    thickness: 30,
    color: '#e91e63',
};

async function init() {

    infoContainer = document.getElementById( 'info' );

    // init camera
    camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.25, 20 );
    camera.position.set( 1.5, 0.75, 1.5 );

    scene = new THREE.Scene();

    // init renderer
    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setClearColor( 0x171717, 1 );
    document.body.appendChild( renderer.domElement );

    // init controls
    controls = new OrbitControls( camera, renderer.domElement );
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1;

    // init materials
    seedMaterial = new SeedMaterial();
    seedMaterial.side = THREE.DoubleSide;

    maskMaterial = new THREE.MeshBasicMaterial( { color: 0xffffff, side: THREE.DoubleSide } );
    
    // initialize the JFA ping pong targets
    // note that integer targets require non-interpolated filters to function
    targets = [
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        } ),
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        } ),
    ];

    masks = [
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RedFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
        } ),
        new THREE.WebGLRenderTarget( 1, 1, {
            format: THREE.RedFormat,
            type: THREE.UnsignedByteType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
        } ),
    ];

    // create a quad for the final screen effect
    effectQuad = new FullScreenQuad( new EffectMaterial() );

    jfaQuad = new FullScreenQuad( new JFAMaterial() );

    seedQuad = new FullScreenQuad( new SeedMaterial() );

    expandQuad = new FullScreenQuad( new ExpandMaskMaterial() );

    // models
    let url = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/vilhelm-13/vilhelm_13.glb';
    let yRotation = Math.PI;

    if ( window.location.hash.includes( 'rover' ) ) {

        url = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/refs/heads/main/models/nasa-m2020/Perseverance.glb';
        yRotation = 0.0;

    } else if ( window.location.hash.includes( 'terrarium' ) ) {

        url = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/refs/heads/main/models/terrarium-robots/scene.gltf';
        yRotation = 0.0;

    }

    // load the model & env map
    const modelPromise = new GLTFLoader()
        .setMeshoptDecoder( MeshoptDecoder )
        .loadAsync( url )
        .then( gltf => {

            gltf.scene.rotation.y += yRotation;

            const box = new THREE.Box3().setFromObject( gltf.scene );
            box.getCenter( gltf.scene.position ).multiplyScalar( - 1 );

            const sphere = new THREE.Sphere();
            box.getBoundingSphere( sphere )
            gltf.scene.scale.setScalar( 1 / sphere.radius );
            gltf.scene.position.multiplyScalar( 1 / sphere.radius );

            gltf.scene.updateMatrixWorld();

            gltf.scene.traverse( c => {

                if ( c.material ) {

                    c.material.transparent = false;
                    c.material.depthWrite = true;

                }

            } );
            scene.add( gltf.scene );

        } );

    const envPromise = await new HDRLoader()
        .loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr' )
        .then( tex => {

            tex.mapping = THREE.EquirectangularReflectionMapping;
            scene.environment = tex;
            scene.environmentRotation.set( 0.6, 0, 0 );
            scene.environmentIntensity = 1.2;
            

        } );

    await Promise.all( [ modelPromise, envPromise ] );

    renderer.setAnimationLoop( animate );

    const gui = new GUI();
    gui.add( params, 'mode', { 'Mask': - 1, 'Coordinate': 0, 'SDF': 1, 'Outline': 2, 'Glow': 3, 'Pulse': 4, 'Halftone': 5, 'Rings': 6 } );
    gui.add( params, 'inside' );
    gui.add( params, 'thickness', 1, 250, 0.25 );
    gui.addColor( params, 'color' );

    window.addEventListener( 'resize', onWindowResize );
    onWindowResize();

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio;
    renderer.setSize( w, h );
    renderer.setPixelRatio( dpr );

    renderer.domElement.style.imageRendering = 'pixelated'

    targets[ 0 ].setSize( dpr * w, dpr * h );
    targets[ 1 ].setSize( dpr * w, dpr * h );

}

function animate() {

    // frame time tracking
    let frameDelta;
    if ( lastFrameStart === - 1 ) {

        lastFrameStart = window.performance.now();

    } else {

        frameDelta = window.performance.now() - lastFrameStart;
        frameTime += ( frameDelta - frameTime ) / ( frameSamples + 1 );
        if ( frameSamples < 60 ) {
        
            frameSamples ++

        }

        lastFrameStart = window.performance.now();

    }

    controls.update();
    renderer.info.autoReset = false;

    // render the main scene
    renderer.setClearColor( 0x171717, 1 );
    renderer.render( scene, camera );

    //

    // render a mask
    let maskWidth = Math.max( Math.floor( targets[ 0 ].width / params.thickness ), 3 );
    let maskHeight = Math.max( Math.floor( targets[ 0 ].height / params.thickness ), 3 );

    masks[ 0 ].setSize( maskWidth, maskHeight );
    masks[ 1 ].setSize( maskWidth, maskHeight );

    scene.overrideMaterial = maskMaterial;
    renderer.setClearColor( 0, 0 );
    renderer.setRenderTarget( masks[ 0 ] );
    renderer.render( scene, camera );
    scene.overrideMaterial = null;
    renderer.setRenderTarget( null );

    // expand the mask
    for ( let i = 0; i < 4; i ++ ) {

        expandQuad.material.source = masks[ 0 ].texture;
        renderer.setRenderTarget( masks[ 1 ] );
        expandQuad.render( renderer );
        renderer.setRenderTarget( null );

        masks.reverse();

    }

    masks.reverse();

    // set scissor for operations
    camera.updateMatrixWorld();
    box.setFromObject( scene ).getBoundingSphere( sphere );

    const offset = sphere.center.clone();
    offset.applyMatrix4( camera.matrixWorldInverse );
    offset.x += sphere.radius;
    offset.y += sphere.radius;
    offset.applyMatrix4( camera.projectionMatrix );

    sphere.center.project( camera ).multiplyScalar( 0.5 );
    sphere.center.x += 0.5;
    sphere.center.y += 0.5;
    sphere.center.z = 0;

    offset.multiplyScalar( 0.5 );
    offset.x += 0.5;
    offset.y += 0.5;
    offset.z = 0;

    let { width, height } = targets[ 0 ];
    width /= renderer.getPixelRatio();
    height /= renderer.getPixelRatio();

    const delta = Math.max( Math.abs( sphere.center.x - offset.x ) * width, Math.abs( sphere.center.y - offset.y ) * height ) + params.thickness;
    sphere.center.x *= width;
    sphere.center.y *= height;

    const { x, y } = sphere.center;
    renderer.setScissorTest( true );
    renderer.setScissor( x - delta, y - delta, delta * 2, delta * 2 );

    //

    // initialize the JFA seed - negative values are "inside" the mesh to be rendered
    renderer.setRenderTarget( targets[ 0 ] );
    seedQuad.material.depthWrite = false;
    seedQuad.render( renderer );

    // render the model
    scene.overrideMaterial = seedMaterial;
    seedMaterial.negative = true;
    renderer.autoClear = false;
    renderer.render( scene, camera );
    renderer.autoClear = true;
    scene.overrideMaterial = null;
    renderer.setRenderTarget( null );

    // JFA ping pong
    let step = Math.min( Math.max( targets[ 0 ].width, targets[ 0 ].height ), params.thickness );
    while( true ) {

        jfaQuad.material.step = step;
        jfaQuad.material.source = targets[ 0 ].texture;
        jfaQuad.material.mask = masks[ 1 ].texture;

        renderer.setRenderTarget( targets[ 1 ] );
        jfaQuad.render( renderer );
        renderer.setRenderTarget( null );

        targets.reverse();

        if ( step <= 1 ) {

            break;

        }

        step = Math.ceil( step * 0.5 );

    }

    // render the final effect
    renderer.autoClear = false;
    effectQuad.material.time = performance.now();
    effectQuad.material.map = targets[ 0 ].texture;
    effectQuad.material.mask = masks[ 1 ].texture;
    effectQuad.material.thickness = params.thickness;
    effectQuad.material.mode = params.mode;
    effectQuad.material.inside = params.inside;
    effectQuad.material.color.set( params.color );
    effectQuad.render( renderer );
    renderer.autoClear = true;

    renderer.setScissorTest( false );

    // update stats
    infoContainer.innerText = 
        `Draw Calls: ${ renderer.info.render.calls }\n` +
        `Frame Time: ${ frameTime.toFixed( 2 ) }ms\n` +
        `FPS       : ${ ( 1000 / frameTime ).toFixed( 2 ) }`;
    renderer.info.reset();

}

class ExpandMaskMaterial extends THREE.ShaderMaterial {

    get source() {

        return this.uniforms.source.value;

    }

    set source( v ) {

        this.uniforms.source.value = v;

    }

    constructor() {

        super( {

            uniforms: {
                source: { value: null },
            },

            vertexShader: /* glsl */`

                void main() {

                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                uniform sampler2D source;
                uniform int outline;
                void main() {

                    ivec2 currCoord = ivec2( gl_FragCoord.xy );
                    float currValue = texelFetch( source, currCoord, 0 ).r;
                    float result = 0.0;
                    for ( int x = - 1; x <= 1; x ++ ) {

                        for ( int y = - 1; y <= 1; y ++ ) {

                            if ( x == 0 && y == 0 ) {

                                continue;

                            }

                            ivec2 coord = currCoord + ivec2( x, y );
                            float otherValue = texelFetch( source, coord, 0 ).r;

                            if ( otherValue != 0.0 ) {

                                gl_FragColor = vec4( 1.0 );
                                return;

                            }

                        }

                    }

                    gl_FragColor = vec4( 0.0 );

                }

            `,

        } );

    }

}

class SeedMaterial extends THREE.ShaderMaterial {

    get negative() {

        return this.uniforms.negative.value === - 1;

    }

    set negative( v ) {

        this.uniforms.negative.value = v ? - 1 : 1;

    }

    constructor() {

        super( {

            uniforms: {
                negative: { value: 1 },
            },

            vertexShader: /* glsl */`

                void main() {

                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                uniform int negative;
                void main() {

                    gl_FragColor = vec4( gl_FragCoord.xy, 1e4 * float( negative ), 1 );

                }

            `,

        } );

    }

}

class EffectMaterial extends THREE.ShaderMaterial {

    get time() {

        return this.uniforms.time.value

    }

    set time( v ) {

        this.uniforms.time.value = v;

    }

    get map() {

        return this.uniforms.map.value;

    }

    set map( v ) {

        this.uniforms.map.value = v;

    }

    get mask() {

        return this.uniforms.mask.value;

    }

    set mask( v ) {

        this.uniforms.mask.value = v;

    }

    get thickness() {

        return this.uniforms.thickness.value;

    }

    set thickness( v ) {

        this.uniforms.thickness.value = v;

    }

    get mode() {

        return this.uniforms.mode.value;

    }

    set mode( v ) {

        this.uniforms.mode.value = v;

    }

    get inside() {

        return this.uniforms.inside.value === - 1;

    }

    set inside( v ) {

        this.uniforms.inside.value = v ? - 1 : 1;

    }

    get color() {

        return this.uniforms.color.value;

    }

    constructor() {

        super( {

            transparent: true,
            uniforms: {
                time: { value: 0 },
                map: { value: null },
                mask: { value: null },
                color: { value: new THREE.Color() },
                thickness: { value: 5 },
                inside: { value: 1 },
                mode: { value: 1 },
            },

            vertexShader: /* glsl */`

                varying vec2 vUv;
                void main() {

                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                varying vec2 vUv;
                uniform float time;
                uniform sampler2D map;
                uniform sampler2D mask;
                uniform float thickness;
                uniform int mode;
                uniform int inside;
                uniform vec3 color;

                float fwidth2( float v ) {

                    float vdy = dFdy( v );
                    float vdx = dFdx( v );
                    return length( vec2( vdy, vdx ) );

                }

                void main() {

                    vec2 size = vec2( textureSize( map, 0 ) );
                    ivec2 currCoord = ivec2( vUv * size );
                    vec3 s = texelFetch( map, currCoord, 0 ).rgb;

                    if ( s.b == 0.0 ) {

                        discard;

                    }

                    if ( mode == - 1 ) {

                        float v = texture( mask, vUv ).r;
                        gl_FragColor = vec4( v, v, v, 1 );

                    } else if ( mode == 0 ) {

                        // coordinate
                        gl_FragColor = vec4( vec3( s ) / vec3( size, 1 ), 1 );

                    } else if ( mode == 1 ) {

                        // sdf
                        float dist = abs( s.b ) / thickness;
                        gl_FragColor = vec4( dist, dist, dist, 1 );

                    } else if ( mode == 2 ) {

                        // outline
                        float dist = s.b * float( inside );

                        // NOTE: for some reason this fwidth call is breaking on Android
                        // float w = clamp( fwidth2( dist ), - 1.0, 1.0 ) * 0.5;
                        float w = 0.5;
                        float val =
                            smoothstep( thickness + w, thickness - w, dist ) *
                            smoothstep( - w - 1.0, w - 1.0, dist );                        

                        gl_FragColor.rgb = vec3( color );
                        gl_FragColor.a = clamp( val, 0.0, 1.0 );

                    } else if ( mode == 3 ) {

                        // glow
                        float dist = s.b * float( inside );

                        // NOTE: for some reason this fwidth call is breaking on Android
                        // float w = clamp( fwidth2( dist ), - 1.0, 1.0 ) * 0.5;
                        float w = 0.5;

                        gl_FragColor.rgb = color;
                        gl_FragColor.a = ( 1.0 - dist / thickness ) * smoothstep( - w - 1.0, w - 1.0, dist );

                    } else if ( mode == 4 ) {

                        // pulse
                        float dist = s.b * float( inside );
                        float w = clamp( fwidth2( dist ), - 1.0, 1.0 ) * 0.5;
                        float clip =
                            smoothstep( thickness + w, thickness - w, dist ) *
                            smoothstep( - w - 1.0, w - 1.0, dist );

                        float norm = dist / thickness;
                        float fade = 1.0 - pow( norm, 2.0 );
                        float pulse = sin( time * - 0.01 + 20.0 * pow( norm + 0.2, 4.0 ) );

                        gl_FragColor.rgb = mix( vec3( color ), vec3( 1 ), 0.5 * pow( 1.0 - norm, 4.0 ) );
                        gl_FragColor.a = clip * fade * smoothstep( 0.0, fwidth2( pulse ), pulse );

                    } else if ( mode == 5 ) {

                        // halftone
                        float dotRadius = 13.0 * min( thickness, 40. ) * 0.02;
                        float dotWidth = dotRadius * 2.0;
                        vec2 closestDot = floor( vec2( currCoord ) / dotWidth ) * dotWidth + vec2( dotRadius );

                        float alpha = 0.0;
                        for ( int x = - 1; x <= 1; x ++ ) {

                            for ( int y = - 1; y <= 1; y ++ ) {

                                vec2 offset = vec2( x, y ) * dotWidth;
                                vec2 dotCoord = closestDot + offset;

                                float dotStrength = texelFetch( map, ivec2( dotCoord ), 0 ).b * float( inside );
                                if ( dotStrength != 0.0 ) {

                                    dotStrength += dotRadius * 1.3;
                                    dotStrength /= 1.5;

                                    float strength = clamp( 1.0 - dotStrength / thickness, 0.0, 1.0 );
                                    strength = 1.0 - pow( 1.0 - strength, 0.75 );

                                    float distToDot = length( vec2( currCoord ) - dotCoord );
                                    float newAlpha = smoothstep( strength * dotWidth, strength * dotWidth - 1.0, distToDot );
                                    alpha = max( alpha, newAlpha );

                                }

                            }

                        }

                        //

                        float w = 0.5;
                        gl_FragColor.rgb = color;
                        gl_FragColor.a = alpha * smoothstep( - w - 1.0, w - 1.0, s.b * float( inside ) );

                    } else if ( mode == 6 ) {

                        // rings
                        float dist = s.b * float( inside );
                        float value = clamp( 1.0 - dist / thickness, 0.0, 1.0 );
                        float stride = 15.0;

                        // NOTE: for some reason this fwidth call is breaking on Android
                        float w = 0.5;

                        gl_FragColor.rgb = color;
                        gl_FragColor.a =
                            smoothstep( 0.2 + w / thickness, 0.2 - w / thickness, mod( ( 1.0 - value ) * thickness / stride, 1.0 ) ) *
                            smoothstep( - w - 1.0, w - 1.0, dist ) *
                            smoothstep( stride * floor( thickness / stride ) + w, stride * floor( thickness / stride ) - w, dist + 1.0 );

                    }

                    if ( gl_FragColor.a <= 0.0 ) {

                        discard;

                    }

                    #include <colorspace_fragment>

                }

            `,

        } );
        
    }

}

class JFAMaterial extends THREE.ShaderMaterial {

    get source() {

        return this.uniforms.source.value;

    }

    set source( v ) { 

        this.uniforms.source.value = v;

    }

    get mask() {

        return this.uniforms.mask.value;

    }

    set mask( v ) { 

        this.uniforms.mask.value = v;

    }

    get step() {

        return this.uniforms.step.value;

    }

    set step( v ) {

        this.uniforms.step.value = v;

    }

    constructor() {

        super( {

            uniforms: {
                source: { value: null },
                mask: { value: null },
                step: { value: 0 },
            },

            vertexShader: /* glsl */`

                varying vec2 vUv;
                void main() {

                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

                }

            `,

            fragmentShader: /* glsl */`

                varying vec2 vUv;
                uniform sampler2D source;
                uniform sampler2D mask;
                uniform int step;

                void main() {

                    ivec2 size = textureSize( source, 0 );
                    ivec2 currCoord = ivec2( gl_FragCoord.xy );
                    vec3 result = texelFetch( source, currCoord, 0 ).rgb;

                    if ( texture( mask, vUv ).r < 0.5 ) {

                        // discard any changes outside the mask, resulting in a 0 distance
                        gl_FragColor = vec4( result, 1 );
                        discard;

                    }

                    float resultSign = sign( result.z );
                    ivec2 otherCoord;
                    vec3 other;
                    
                    ${

                        // unroll the loops
                        new Array( 9 ).fill().map( ( e, i ) => {

                            const x = i % 3 - 1;
                            const y = Math.floor( i / 3 ) - 1;

                            if ( x == 0 && y === 0 ) {

                                return '';

                            }

                            return /* glsl */`

                                otherCoord = currCoord + ivec2( ${ x }, ${ y } ) * step;
                                if (
                                    otherCoord.x < size.x && otherCoord.x >= 0 &&
                                    otherCoord.y < size.y && otherCoord.y >= 0
                                ) {

                                    other = texelFetch( source, otherCoord, 0 ).rgb;
                                    if ( other.b != 0.0 ) {

                                        // don't bother with the pixel if the distance is 0, meaning it's outside the mask
                                        if ( resultSign != sign( other.z ) ) {

                                            // if the sign is different then we've possibly found a new best coord
                                            float dist = length( vec2( currCoord - otherCoord ) );
                                            if ( dist < result.z * resultSign ) {

                                                result = vec3( otherCoord, dist * resultSign );

                                            }

                                        } else if ( ivec2( other.rg ) != otherCoord ) {

                                            // if the sign is the same then we've possibly found a new best distance
                                            float dist = length( vec2( currCoord - ivec2( other.rg ) ) );
                                            if ( dist < result.z * resultSign ) {

                                                result = vec3( other.rg, dist * resultSign );

                                            }

                                        }

                                    }

                                }
                            
                            `;


                        } ).join( '' )

                    }

                    gl_FragColor = vec4( result, 1.0 );

                }

            `,

        } );

    }

}

init();
