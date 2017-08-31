/**
 * Created by zhuqizhong on 17-6-17.
 */

const WorkerBase = require('yeedriver-base/WorkerBase');

const util = require('util');
const net = require('net');
const _ = require('lodash');

const P = require('bluebird');
const Corx = require('./corx')
const dgram = require('dgram');



class CorxDriver extends WorkerBase {
    constructor(maxSegLength, minGapLength) {
        super(maxSegLength || 16, minGapLength||16);
        this.devices = {};
        this.deviceInfo = {};


    }
}
/**
 * 科星设备的驱动模块
 * @param options {sids:{mac:{in:in_num,out:out_num}}}  in_num为输入  out_num为输出端口
 * @param memories
 */
CorxDriver.prototype.initDriver = function (options, memories) {
    this.rawOptions = options || this.rawOptions || {};
    this.rawOptions.sids = this.rawOptions.sids || {};
    this.devices = this.devices || {};

    _.each(this.rawOptions.sids,(devInfo,devId)=>{
        let type = devInfo.uniqueId || "JDQ016";
        let number = parseInt(type.substr(3)) || 16;
        this.autoReadMaps[devId] = {
            bi_map:[{start:0,end:number-1,len:number}],
            bq_map:[{start:0,end:number-1,len:number}]
        }
        if(devInfo.static && devInfo.address){

            this.devices[devId] = this.devices[devId] ? this.devices[devId] :  new Corx(devId);

            let type = devInfo.uniqueId || "JDQ016";
            let number = parseInt(type.substr(3)) || 16;
            this.devices[devId].init(devInfo.address , number, number);

        }

    })
    this.moduleType =options.moduleType || "CorxDriverV1";
    this.enumDevices();
    setTimeout(()=>{
        if (!this.inited) {
            this.inited = true;
            this.setRunningState(this.RUNNING_STATE.CONNECTED);
            this.setupAutoPoll();
        }
        // this.checkDeviceChange(true);
    },5000);


};
CorxDriver.prototype.enumDevices = function () {
    let server = dgram.createSocket('udp4');
    this.newDevices = {};
    server.on('message', (data, rInfo) => {

        let devId ="";
        _.each(data.slice(2,7),(item)=>{
            devId+=("00"+item.toString(16)).substr(-2);
        })
        this.newDevices[devId] = rInfo;
        let devInfo = this.rawOptions.sids[devId];
        if (devInfo) {
            if(!this.devices[devId]){
                this.devices[devId] = new Corx(devId);
            }
            let type = devInfo.uniqueId || "JDQ016";
            let number = parseInt(type.substr(3)) || 16;
            this.devices[devId].init(rInfo.address , number, number);
        }


    })
    server.bind(60001);
    server.on('listening', () => {
        let client = dgram.createSocket('udp4');
        client.bind(function() {
            client.setBroadcast(true);

        })
        let findData = Buffer.from([0, 0, 0, 0, 0]);


        P.each([0,0,0],()=>{
            return new P((resolve, reject)=>{
                client.send(findData,60000,"255.255.255.255",(err)=>{
                    if(err){
                        reject(err)
                    }
                    else {
                        resolve();
                    }
                })
            })
            // return Q.nbind(client.send,client)(findData,60000,"255.255.255.255");

        }).then(()=>{
            setTimeout( ()=>{
                server.close();
                }, 5000);
        }).catch((error)=>{
            console.error('error in enum devices:', error.message || error);
        }).finally(()=>{
            client.close();

        })

    });

};
CorxDriver.prototype.ReadBI = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readBI(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.WriteBQ = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeBQ(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.WriteBP = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeBP(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.ReadBQ = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readWq(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.WriteWQ = function (mapItem, value, devId) {
    if(this.devices[devId]){
        return this.devices[devId].writeWQ(mapItem, value);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }

};
CorxDriver.prototype.ReadWQ = function (mapItem, devId) {
    if(this.devices[devId]){
        return this.devices[devId].readWq(mapItem);
    }else{
        return P.reject(`device not exist: ${devId}`);
    }
};
CorxDriver.prototype.checkDeviceChange = function (isRefresh) {
    let addDevices = {};
    let delDevices = {};
    let sids = _.cloneDeep(this.rawOptions.sids);

    _.each(this.newDevices,(newItem,key)=>{
        if(!sids[key]&&!isRefresh){
            addDevices[key] = {
                address:newItem.address,
                uniqueId:newItem.uniqueId || "JDQ016"
            }
        }
        else {
            if(newItem.address != sids[key].address){
                addDevices[key] = sids[key];
                addDevices[key].address = newItem.address
            }
        }
        delete sids[key];
    });

    if(!isRefresh){
        _.each(sids,(item,key)=>{
            if(!item.static){
                delDevices[key] = "";
                this.devices[key] && this.devices[key].stop();
                delete this.devices[key];
            }
        });
    }

    if (!_.isEmpty(addDevices))
        this.inOrEx({type: "in", devices: addDevices});//uniqueKey:nodeid,uniqueId:nodeinfo.manufacturerid+nodeinfo.productid})
    //console.log('new Devices:',addDevices);
    if (!_.isEmpty(delDevices)) {
        this.inOrEx({type: "ex", devices: delDevices});
    }
};
CorxDriver.prototype.setInOrEx = function (option) {
    this.enumDevices();
    setTimeout(this.checkDeviceChange.bind(this),3000);

};


module.exports = new CorxDriver();
