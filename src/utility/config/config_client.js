var fs = require("fs");

class ConfigClient{
    constructor(filepath){
        this.filepath = filepath;
        this.config = require(filepath);
        this.get_config = this.get_config.bind(this);
        this.set_config = this.set_config.bind(this);
    }
    reinitialize_config(){
        // hot reload config every time
        delete require.cache[require.resolve(this.filepath)];
        this.config = require(this.filepath)
    }
    get_config(){
        this.reinitialize_config();
        console.log(this.config);
        var cf = this.config;
        return {...cf};
    }
    set_config(cf){
        fs.writeFile(
            this.filepath, JSON.stringify(cf), (err) => {
                console.log(err)
            }
            );
        this.config = cf
    }
}

exports.ConfigClient = ConfigClient;