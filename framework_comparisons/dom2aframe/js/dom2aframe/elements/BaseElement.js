class Position{

	get DOM2AFrameScalingFactor()
	{
        // this.scalingFactor is supposed to be  DOM2Aframe.settings.DOMPixelsPerUnit
		// we divide 1 by pixels_per_unit to get someting we can directly multiply with DOM coordinates to get AFrame coordaintes
		// because: 25 pixels per unit = 25 pixels per meter -> 1 pixel = 1/25 meters
		// so DOMPosition (in pixels) * DOM2AFrameScalingFactor (pixels per meter) = AFramePosition (in meters)

		return 1 / this.DOMPixelsPerUnit;
	}

    constructor(DOMPosition, depthModifier, DOMPixelsPerUnit){
		this.depthModifier = depthModifier;
		this.UpdateFromDOMPosition(DOMPosition);
        this.DOMPixelsPerUnit = DOMPixelsPerUnit;
    }

	UpdateFromDOMPosition(DOMPosition){
		this.DOMPosition = DOMPosition;
		this.AFramePosition = this.CalculateAFramePosition(this.DOMPosition);
		this.AFramePosition.z = this.depthModifier;
	}

	CalculateAFramePosition(DOMPosition){
		// DOMPosition is the return value of domelement.getBoundingClientRect();
		// it has fields .top, .bottom, .left and .right
		// in the DOM, the origin is on the TOP LEFT

		// AFramePosition needs to be in the AFrame coordinate system, which uses x, y and z values and a local origin/pivot at the CENTER of the element
		// In our setup, we just convert into x and y from width and height and keep the "global origin is on the TOP LEFT" idea
		// we put all the elements in a container entity that is then correctly positioned, so we don't have to worry about world-scale positioning or changing of y-axis logic here
		let output = {};
		output.z = 0; // TODO: take into account CSS z-index or other set attributes... will muck up the API a bit though

		let width = DOMPosition.right - DOMPosition.left;
		let height = DOMPosition.bottom - DOMPosition.top; // bottom - top because positive y-axis is pointing DOWN in the DOM, so bottom always > top

		output.x = DOMPosition.left + width/2;
		output.y = DOMPosition.top + height/2; 

		// at this moment, our coordinates are in DOM-scale, which means 1 unit = 1 pixel
		// however, in AFrame, 1 unit = 1 meter and we don't want to directly map 1 pixel = 1 meter of course
		// so, we apply a scaling factor (calculated elsewhere) to bring x, y and z into proper AFrame measures
		output.x *= this.DOM2AFrameScalingFactor;
		output.y *= this.DOM2AFrameScalingFactor * -1; // -1 because AFrame has the y-axis pointing upwards
		output.z *= this.DOM2AFrameScalingFactor; // future proofing the code

		output.width = width * this.DOM2AFrameScalingFactor;
		output.height = height * this.DOM2AFrameScalingFactor;

		return output;
	}

	get x(){
		return this.AFramePosition.x;
	}

	get y(){
		return this.AFramePosition.y;
	}

	get z(){
		return this.AFramePosition.z;
	}

	get width(){
		return this.AFramePosition.width;
	}

	get height(){
		return this.AFramePosition.height;
	}

	get xyz(){
		return {x: this.x, y: this.y, z: this.z};
	}

	EqualsDOMPosition(DOMPosition){
        return 	this.DOMPosition.top 	== DOMPosition.top && 
				this.DOMPosition.bottom == DOMPosition.bottom && 
				this.DOMPosition.left 	== DOMPosition.left && 
				this.DOMPosition.right 	== DOMPosition.right;
	}
}

class Element{
	constructor(DOM2AFrame, domelement, layer){
        this.DOM2AFrame = DOM2AFrame;

		this.domelement = domelement;
        this.domelement.d2aelement = this; // so we can do a reverse lookup if need be (not used by our core setup, but handy for debugging)
		this.aelement = null; // is supposed to be filled in by object creator or, more usually, a subclass constructor

        this.children = new Set();

        this.position = new Position( this.domelement.getBoundingClientRect(), layer, this.DOM2AFrame.settings.DOMPixelsPerUnit );

        //Flag for when we need to redraw
        this._dirty = false;
	}

    // supposed to be called in the ctor of inheriting elements after their .aelement has been assigned
    SetupEventHandlers()
    {
        if( !this.aelement ){
            alert("BaseElement:SetupEventHandlers : requires .aelement to be assigned!");
            return;
        }

        this.mouseEventHandler = new MouseEventHandler(this);

        //Listenes for direct css changes
        // note: attributeOldValue doesn't seem to work for style updates... chucks
        this.mutationObserver = new MutationObserver(this.HandleMutation.bind(this));
        this.mutationObserver.observe( this.domelement, { attributes: true, childList: false,   characterData: true, subtree: false /*, attributeOldValue : true*/ });
        //(new MutationObserver(this.DOM2AFrame.UpdateAll.bind(this.DOM2AFrame))).observe(    this.domelement, { attributes: true, childList: false,  characterData: true, subtree: false });



        this.domelement.addEventListener("eventListenerAdded", this.HandleEventListenerAdded.bind(this));
        this.domelement.addEventListener("eventListenerRemoved", this.HandleEventListenerRemoved.bind(this));

        //Listenes for css animations
        this.domelement.addEventListener("animationstart",  this.StartAnimation.bind(this));
        this.domelement.addEventListener("animationend",    this.StopAnimation.bind(this));

        //Listenes for transition changes, only works on Microsoft Edge
        this.domelement.addEventListener("transitionstart", this.StartAnimation.bind(this));
        this.domelement.addEventListener("transitionend",   this.StopAnimation.bind(this));
        
        // for form elements 
        let self = this;
        this.domelement.addEventListener("input", (evt) => { 
            if( evt.target == this.domelement )
                evt.stopPropagation();

            console.warn("input changed!"); 
            self.HandleMutation(); 
        });

        this.mouseEventHandler._resync(); // perform the initial sync to pick-up mouse handlers that might have been registered before this element // TODO: maybe move this to MouseEventHandler ctor instead?
    }

    HandleEventListenerAdded(evt){
        //console.log("HandleEventListenerAdded", this, evt.detail, evt.target.eventListenerList);
        this.mouseEventHandler.HandleListenersAdded(evt);
    }

    HandleEventListenerRemoved(evt){
        //console.log("HandleEventListenerRemoved", this, evt.detail, evt.target.eventListenerList);
        this.mouseEventHandler.HandleListenersRemoved(evt);
    }

    StartAnimation(evt){
        console.log("ANIMATION STARTED", (evt.target == this.domelement), evt);
        if( evt.target == this.domelement )
            evt.stopPropagation();

        this.StopIntervall();
        this.interval = setInterval(this.UpdateAnimation.bind(this), 1000/this.DOM2AFrame.requestedFPS);
    }

    StopAnimation(evt){
        if( evt.target == this.domelement )
            evt.stopPropagation();

        console.log("ANIMATION STOPPED", (evt.target == this.domelement), evt);
        console.log("%c ANIMATION STOPPED", "background-color: red; color: white; font-size: 2em;");
        console.error("ANIMATION STOPPED", this);
        this.StopIntervall();
        this.UpdateAnimation();
    }

    StopIntervall(){
        clearInterval(this.interval);            
    }

    //Update for one Animation frame
    UpdateAnimation(){
        this.HandleMutation();
        //this.DOM2AFrame.UpdateAll();
        //UpdateAll.bind(this).call();
    }

    get dirty()
    {
        return this._dirty;
    }
    set dirty(val)
    {
        this._dirty = val;
    }

    get AElement()
    {
        return this.aelement;
    }

    get DOMElement()
    {
        return this.domelement;
    }

    //Gets called on the object that invokes the whole update chain, which is garanteed to be dirty
    HandleMutation(mutation){
        console.trace("%c HandleMutation triggered", "color: yellow; background-color: black;", mutation, this);
        this.dirty = true;
        //this.Update();
        this.DOM2AFrame.state.dirty = true;
        this.DOM2AFrame.UpdateAll(); // TODO : FIXME: for now, we're bubbling up (so basically redrawing everything) but eventually we want to only update the changed parts and their children!
    }

    // called once after the element is fully mounted and the THREE.js renderer is coupled etc.
    Init(){
        this._SetupClipping();
        
        for( let child of this.children )
            child.Init();
    }

    Update(forceUpdate = false, updateChildren = true){

        if(updateChildren){
            for( let child of this.children )
                child.Update(forceUpdate, updateChildren);
        }

        // we don't get Mutation events if it's just the position that has changed indirectly (due to a style change on another element for example)
        // so we also need to check if our current position is still valid and not only depend on this.dirty to make decisions 
        var DOMPosition = this.domelement.getBoundingClientRect();

        //Check if something changed since last time, else we just stop the update
        if(this.position.EqualsDOMPosition(DOMPosition) && !this.dirty && !forceUpdate)
            return;

        //console.log("UPDATE TRIGGERED ", (this.position.EqualsDOMPosition(DOMPosition)), this.dirty, forceUpdate, this.domelement);

        //Cache the last position
        this.position.UpdateFromDOMPosition(DOMPosition);
        

        var element_style = window.getComputedStyle(this.domelement);

        //Set the opacity of the element
        var new_opacity = 0;
        if(element_style.getPropertyValue("visibility") !== "hidden" && element_style.getPropertyValue("display") !== "none")
            new_opacity = parseFloat(element_style.getPropertyValue("opacity"));
    	//this.aelement.setAttribute("opacity", "");
    	this.aelement.setAttribute("opacity", new_opacity);

        
        this.ElementSpecificUpdate(element_style);

        this.UpdateClipping();

        this.dirty = false;
    }

    // in BaseElement because shared by various elements, but not auto-called by Update() because not each element requires it
    UpdateBorders(element_style){
		if( !this.borderObject ){		
			let threePlane = this.aelement.object3D.children[0]; // without children[0], we would get the encompassing GROUP, which will position our borders erroneously

			// this works, but linewidth isn't adjustable 
			// TODO: change to https://stackoverflow.com/questions/11638883/thickness-of-lines-using-three-linebasicmaterial or https://stemkoski.github.io/Three.js/Outline.html 
			var box = new THREE.BoxHelper( /*this.aelement.object3D*/ threePlane, 0x00ff00 );
			box.material.lineWidth = 500; // for some reason, this doesn't work on windows platforms: https://threejs.org/docs/#api/materials/LineBasicMaterial
			box.material.color = {r: 0, g: 0, b: 0};
			box.material.needsUpdate = true;
			this.aelement.setObject3D('border', box);
			this.borderObject = box;
		}
		
		let borderWidth = parseFloat(element_style.borderWidth);
        if( this.customBorder )
            borderWidth = this.customBorder.width;
		
		if( borderWidth == 0 ){
			this.borderObject.material.visible = false;
		}
		else{
			this.borderObject.material.visible = true;

			this.borderObject.material.lineWidth = borderWidth;

			// TODO: cache this value?
			// TODO: use decent Color class (e.g. the one from html2canvas, which this is based on)
            
            if( this.customBorder )
                this.borderObject.material.color = this.customBorder.color;
            else{
                let colorRGB = element_style.borderColor;

                let _rgb = /^rgb\((\d{1,3}) *, *(\d{1,3}) *, *(\d{1,3})\)$/;
                let match = colorRGB.match(_rgb);
                if( match !== null ){
                    this.borderObject.material.color = {r: Number(match[1]) / 256, g: Number(match[2]) / 256, b: Number(match[3]) / 256};
                }
            }

		}
		
		this.borderObject.material.needsUpdate = true;
	}

    // ex. GetAsset("http://google.com/logo.png", "img")
    GetAsset(path, type){
        var assets = this.DOM2AFrame.AFrame.assets.getChildren();

        for (var i = 0; i < assets.length; i++)
            if (assets[i].getAttribute("src") === path)
                return assets[i].getAttribute("id");

        //Asset creation
        var asset = document.createElement(type);
        asset.setAttribute("src", path);
        var id = "asset-" + this.DOM2AFrame.state.getNextAssetID();
        asset.setAttribute("id", id);

        this.DOM2AFrame.AFrame.assets.appendChild(asset);

        return id;
    }


    _GetClippingContext(){
        let output = undefined;
        
        if( this.domelement.getAttribute("id") == "overflowp2" )
            console.log("Clipping overflowp2", this.domelement.parentNode, this.domelement.parentNode.d2aelement);

        // TODO: make sure that we always have a d2a path up to the clipping parent! i.e. if we skip certain dom elements but process their children, we still want to be able to get the clipping context! 
        if( this.domelement.parentNode && this.domelement.parentNode.d2aelement && this.domelement.parentNode.d2aelement.clippingContext ){
            // our parent node has clipping set : we just inherit
            output = this.domelement.parentNode.d2aelement.clippingContext;
        }
        else{
            var element_style = window.getComputedStyle(this.domelement);
            if( element_style.overflow && element_style.overflow == "hidden"){ // TODO: support other overflow types as well (scroll is going to be very difficult with this setup though...) 

                let clippingContext = {};
                clippingContext.authority = this;

                clippingContext.bottom = new THREE.Plane(new THREE.Vector3(0,1,0),  0); // normal pointing UP
                clippingContext.top    = new THREE.Plane(new THREE.Vector3(0,-1,0), 0); // normal pointing DOWN
                clippingContext.left   = new THREE.Plane(new THREE.Vector3(1,0,0),  0); // normal pointing RIGHT
                clippingContext.right  = new THREE.Plane(new THREE.Vector3(-1,0,0), 0); // normal pointing LEFT

                clippingContext.planes = [clippingContext.bottom, clippingContext.top, clippingContext.left, clippingContext.right];

                output = clippingContext;
            }
        }

        return output;
    }

    // needed for overflow
    _SetupClipping(){
        
        if( !this.DOM2AFrame.settings.clippingEnabled )
            return;

        // currently, we only support a single overflow context in a subtree
        // i.e. a container with overflow:hiddden set, cannot have children that also have overflow: hidden set 
        // to support that, we would have a seperate clippingContext per child, but also have children have the clippingPlanes of all their active clipping parents set (merger of different clipping plane arrays)
        // this is certianly possible, but too complex for our needs right now 

        // TODO: we currently don't support overflow settings changing at runtime! 

        let clippingContext = this._GetClippingContext();

        if( clippingContext ){

            this.clippingContext = clippingContext;

            // we are sure the renderer is loaded (DOM2AFrame only calls Update() after the element has a THREE.js equivalent loaded)
            let obj3d = this.aelement.object3D;
            if( !obj3d || !obj3d.children || !obj3d.children.length > 0 || !obj3d.children[0].material ){
                console.error("Trying to set clipping but no Three.js element known!", obj3d, this);
                return;
            }

            let material = obj3d.children[0].material; // in a-frame, all object3D's are a Group, even if they just have 1 child.

            // we need to set the clipping planes on all elements in the clipped subtree, since each element does its own clipping in their shader
            // however, the clippingContext is a reference value, so if we update these clipping plane definitions once (in the parent's Update), it will cascade to all these children as well
            material.clipping = true;
            //material.clippingPlanes = clippingContext.planes;
            material.clippingPlanes = [clippingContext.bottom];

            console.error("Aded clipping to ", this.domelement, this.clippingContext.authority.domelement );

            this.UpdateClipping(); // position the planes correctly for initialization
            material.needsUpdate = true;
        }
    }

    UpdateClipping(){
        if( !this.clippingContext || 
            !this.clippingContext.authority == this ) // only the element with actual overflow set can change positioning of the clipping planes
            return;

        // TODO: we currently don't support overflow settings changing at runtime! 
        
        // TODO: actually change coPlanarPoint's of the planes depending on our position! 


        let bottomPoint = new THREE.Vector3( this.position.x, this.position.y /*- (this.position.height/2)*/, this.position.z ); 
        bottomPoint = bottomPoint.add( this.DOM2AFrame.AFrame.container.object3D.position );
        
        this.clippingContext.bottom.setFromNormalAndCoplanarPoint(new THREE.Vector3( 0, 1, 0 ), bottomPoint).normalize();

        this.aelement.object3D.children[0].material.needsUpdate = true; // TODO: shouldn't be needed! remove!
        
        console.warn("Updating clipping : ", this.DOM2AFrame.AFrame.scene.renderer.localClippingEnabled, this.aelement.object3D.children[0].material.clippingPlanes, this.clippingContext.bottom, this.domelement);


        //     var dir = new THREE.Vector3(0,1,0);
        //     var centroid = new THREE.Vector3(containerPosition.x, containerPosition.y - (containerPosition.height / 2),containerPosition.z);
        //     centroid = centroid.add(DOM2AFrame1.AFrame.container.object3D.position); // in-place operation

        //    // alert( JSON.stringify(centroid.add(DOM2AFrame1.AFrame.container.object3D.position)) );
        //     var plane = new THREE.Plane();
        //     plane.setFromNormalAndCoplanarPoint(dir, centroid).normalize();

        //     let bottomPlane = plane; //new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), containerBottomY );
        //     material.clippingPlanes = [bottomPlane];

        //     bottomClippingPlane = bottomPlane;

        //     box.setAttribute("position", centroid.x + " " + centroid.y + " " + centroid.z);

        //     material.needsUpdate = true;

    }
}