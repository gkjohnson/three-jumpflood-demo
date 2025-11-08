
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

const params = {
    mode: 2,
    inside: false,
    thickness: 5,
    color: '#e91e63',
};

async function init() {

    infoContainer = document.getElementById( 'info' );

    camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.25, 20 );
    camera.position.set( 3, 2, 3 );

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setClearColor( 0x171717, 1 );
    document.body.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    // controls.autoRotate = true;
    controls.autoRotateSpeed = 1;

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

    // load the model & env map
    const modelPromise = new GLTFLoader()
        .setMeshoptDecoder( MeshoptDecoder )
        .loadAsync( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/vilhelm-13/vilhelm_13.glb' )
        .then( gltf => {

            gltf.scene.scale.setScalar( 0.025 );
            gltf.scene.rotation.y += Math.PI;

            new THREE.Box3()
                .setFromObject( gltf.scene )
                .getCenter( gltf.scene.position )
                .multiplyScalar( - 1 );

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

        } );

    await Promise.all( [ modelPromise, envPromise ] );

    renderer.setAnimationLoop( animate );

    const gui = new GUI();
    gui.add( params, 'mode', { 'Mask': - 1, 'Coordinate': 0, 'SDF': 1, 'Outline': 2, 'Glow': 3 } );
    gui.add( params, 'inside' );
    gui.add( params, 'thickness', 0, 50, 0.25 );
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

    // render a mask
    masks[ 0 ].setSize( Math.floor( targets[ 0 ].width / params.thickness ), Math.floor( targets[ 0 ].height / params.thickness ) );
    masks[ 1 ].setSize( masks[ 0 ].width, masks[ 0 ].height );

    scene.overrideMaterial = maskMaterial;
    renderer.setClearColor( 0, 0 );
    renderer.setRenderTarget( masks[ 0 ] );
    renderer.render( scene, camera );
    scene.overrideMaterial = null;
    renderer.setRenderTarget( null );

    // expand the mask
    for ( let i = 0; i < 3; i ++ ) {

        expandQuad.material.source = masks[ 0 ].texture;
        renderer.setRenderTarget( masks[ 1 ] );
        expandQuad.render( renderer );
        renderer.setRenderTarget( null );

        masks.reverse();

    }

    masks.reverse();

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
    effectQuad.material.map = targets[ 0 ].texture;
    effectQuad.material.mask = masks[ 1 ].texture;
    effectQuad.material.thickness = params.thickness;
    effectQuad.material.mode = params.mode;
    effectQuad.material.inside = params.inside;
    effectQuad.material.color.set( params.color );
    effectQuad.render( renderer );
    renderer.autoClear = true;

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
                    if ( mode == - 1 ) {

                        float v = texture( mask, vUv ).r;
                        gl_FragColor = vec4( v, v, v, 1 );

                    } else if ( mode == 0 ) {

                        // coordinate
                        vec3 coord = texelFetch( map, currCoord, 0 ).rgb;
                        gl_FragColor = vec4( vec3( coord ) / vec3( size, 1 ), 1 );

                    } else if ( mode == 1 ) {

                        // sdf
                        float dist = abs( texelFetch( map, currCoord, 0 ).b ) / thickness;
                        gl_FragColor = vec4( dist, dist, dist, 1 );

                    } else if ( mode == 2 ) {

                        // outline
                        vec3 coord = texelFetch( map, currCoord, 0 ).rgb;
                        float dist = coord.b * float( inside );
                        float w = clamp( fwidth2( dist ), - 1.0, 1.0 ) * 0.5;
                        float val =
                            smoothstep( thickness + w, thickness - w, dist ) *
                            smoothstep( - w - 1.0, w - 1.0, dist );

                        gl_FragColor.rgb = vec3( color );
                        gl_FragColor.a = val;

                    } else if ( mode == 3 ) {

                        // glow
                        vec3 coord = texelFetch( map, currCoord, 0 ).rgb;
                        float dist = coord.b * float( inside );
                        float w = clamp( fwidth2( dist ), - 1.0, 1.0 ) * 0.5;

                        gl_FragColor.rgb = color;
                        gl_FragColor.a = ( 1.0 - dist / thickness ) * smoothstep( - w - 1.0, w - 1.0, dist );

                    }

                    // float v = texture( mask, vUv ).r;
                    // gl_FragColor = mix( gl_FragColor * gl_FragColor.a, vec4( v, v, v, 1 ), 0.25 );
                    // gl_FragColor.a = 1.0;

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

                        gl_FragColor = vec4( result, 1 );
                        return;

                    }

                    float resultSign = sign( result.z );
                    ivec2 otherCoord;
                    vec3 other;
                    
                    ${

                        // unroll the loops
                        new Array( 9 ).fill().map( ( e, i ) => {

                            const x = i % 3 - 1;
                            const y = Math.floor( i / 3 ) - 1;

                            if ( x == 0 && y === 0 || ( x !== 0 && y !== 0 ) ) {

                                return '';

                            }

                            return /* glsl */`

                                otherCoord = currCoord + ivec2( ${ x }, ${ y } ) * step;
                                if (
                                    otherCoord.x < size.x && otherCoord.x >= 0 &&
                                    otherCoord.y < size.y && otherCoord.y >= 0
                                ) {

                                    other = texelFetch( source, otherCoord, 0 ).rgb;
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
